import React, { useState, useEffect, useCallback } from 'react';
import { CanvasStage } from './components/canvas/CanvasStage'
import { ClassSelector, ClassDefinition } from './components/ClassSelector'
import { ProjectSelector } from './components/ProjectSelector'
import { db, ValidationResult } from './lib/tauri-commands';
import { open } from '@tauri-apps/plugin-dialog';

function App() {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [imageId, setImageId] = useState<number | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [images, setImages] = useState<any[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);

  // Class management
  const [classes, setClasses] = useState<ClassDefinition[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);

  // Initialize app (but don't load project automatically)
  useEffect(() => {
    const initApp = async () => {
      try {
        // Start Python server (non-blocking)
        console.log("Starting Python server...");
        db.startPythonServer().catch(err => {
          console.warn("Python server failed to start:", err);
          // Continue anyway - app can work without AI features
        });
      } catch (err) {
        console.error("Initialization failed:", err);
      } finally {
        setIsLoading(false);
      }
    };

    initApp();

    // Cleanup: Stop Python server on unmount
    return () => {
      db.stopPythonServer().catch(console.error);
    };
  }, []);

  // Load a specific project
  const loadProject = useCallback(async (id: number) => {
    try {
      setIsLoading(true);

      const project = await db.getProject(id);
      if (!project) {
        alert("Project not found");
        return;
      }

      setProjectId(project.id);
      setProjectName(project.name);

      // Load ontology (classes)
      try {
        const ontology = JSON.parse(project.ontology);
        if (Array.isArray(ontology) && ontology.length > 0) {
          setClasses(ontology);
          setSelectedClassId(ontology[0].id);
        }
      } catch (e) {
        console.error("Failed to parse ontology:", e);
      }

      // Get Images
      const imagesList = await db.getImages(project.id);

      // Initialize status for images that don't have it set (backwards compatibility)
      for (const img of imagesList) {
        if (!img.status) {
          // Check if this image has annotations
          const annotations = await db.getAnnotations(img.id);
          const newStatus = annotations.length > 0 ? 'LABELED' : 'UNLABELED';
          await db.updateImageStatus(img.id, newStatus);
          img.status = newStatus; // Update in-memory object
        }
      }

      setImages(imagesList);

      if (imagesList.length > 0) {
        // Find first unlabeled image, or default to first image
        let startIndex = imagesList.findIndex(img => img.status === 'UNLABELED');
        if (startIndex === -1) {
          startIndex = 0; // If all are labeled, start from beginning
        }

        const currentImage = imagesList[startIndex];
        setCurrentImageIndex(startIndex);
        setImageId(currentImage.id);
        setImageSrc(currentImage.file_path);

        // Load Annotations
        const projectAnnotations = await db.getAnnotations(currentImage.id);

        // Parse coordinates from JSON string
        const parsedAnns = projectAnnotations.map(ann => {
          try {
            const coords = JSON.parse(ann.coordinates);
            return {
              ...ann,
              ...coords,
              color: classes.find(c => c.id === ann.label_id)?.color || '#00ff00'
            };
          } catch (e) {
            console.error("Failed to parse annotation coordinates:", e);
            return ann;
          }
        });

        setAnnotations(parsedAnns);
      }
    } catch (err) {
      console.error("Failed to load project:", err);
      alert(`Error loading project: ${err}`);
    } finally {
      setIsLoading(false);
    }
  }, [classes]);

  const createNewProject = useCallback(async (name: string) => {
    try {
      // Start with empty ontology - user will add classes as needed
      const defaultOntology = JSON.stringify([]);
      const id = await db.createProject(name, defaultOntology);
      await loadProject(id);
    } catch (err) {
      console.error("Failed to create project:", err);
      alert(`Error creating project: ${err}`);
    }
  }, [loadProject]);

  // Auto-save classes when they change
  useEffect(() => {
    const saveClasses = async () => {
      if (projectId && projectName && classes.length > 0) {
        try {
          const ontology = JSON.stringify(classes);
          await db.updateProject(projectId, projectName, ontology);
          console.log('Classes saved to database');
        } catch (err) {
          console.error('Failed to save classes:', err);
        }
      }
    };

    // Debounce to avoid saving too frequently
    const timeoutId = setTimeout(saveClasses, 500);
    return () => clearTimeout(timeoutId);
  }, [classes, projectId, projectName]);

  // Cascade delete: Remove annotations when their class is deleted
  // Track previous classes to detect deletions
  const prevClassesRef = React.useRef<Set<number>>(new Set());

  useEffect(() => {
    const currentClassIds = new Set(classes.map(c => c.id));
    const prevClassIds = prevClassesRef.current;

    // Check if any classes were deleted
    const deletedClassIds = Array.from(prevClassIds).filter(id => !currentClassIds.has(id));

    if (deletedClassIds.length > 0) {
      console.log(`Classes deleted: ${deletedClassIds.join(', ')}`);

      // Find annotations that use deleted classes
      const annotationsToRemove = annotations.filter(ann =>
        ann.label_id !== undefined &&
        ann.label_id !== null &&
        deletedClassIds.includes(ann.label_id)
      );

      if (annotationsToRemove.length > 0) {
        console.log(`Removing ${annotationsToRemove.length} annotations with deleted classes`);

        // Delete from database if they have IDs
        const deletePromises = annotationsToRemove
          .filter(ann => typeof ann.id === 'number')
          .map(ann => db.deleteAnnotation(ann.id as number));

        Promise.all(deletePromises).catch(err => {
          console.error("Failed to delete some annotations:", err);
        });

        // Remove from local state
        setAnnotations(prevAnnotations =>
          prevAnnotations.filter(ann =>
            !deletedClassIds.includes(ann.label_id)
          )
        );
      }
    }

    // Update previous classes
    prevClassesRef.current = currentClassIds;
  }, [classes, annotations]);

  const handleSave = useCallback(async (showAlert = true) => {
    if (!imageId || !projectId) return;
    console.log("Saving annotations...");

    try {
      // Save all annotations for the current image
      const savedIds: number[] = [];

      for (const ann of annotations) {
        // Create payload, excluding temporary IDs and client-side fields
        const payload = {
          id: typeof ann.id === 'number' ? ann.id : undefined,
          image_id: imageId,
          label_id: ann.label_id ?? selectedClassId,
          geometry_type: 'box',
          source: ann.source || 'manual',
          coordinates: JSON.stringify({
            x: ann.x,
            y: ann.y,
            width: ann.width,
            height: ann.height
          })
        };

        const savedId = await db.saveAnnotation(payload);
        savedIds.push(savedId);
      }

      // Reload annotations from database to get proper IDs
      const reloadedAnnotations = await db.getAnnotations(imageId);

      // Parse coordinates from JSON string
      const parsedAnns = reloadedAnnotations.map(ann => {
        try {
          const coords = JSON.parse(ann.coordinates);
          return {
            ...ann,
            ...coords,
            color: classes.find(c => c.id === ann.label_id)?.color || '#00ff00'
          };
        } catch (e) {
          console.error("Failed to parse annotation coordinates:", e);
          return ann;
        }
      });

      setAnnotations(parsedAnns);

      // Update image status to LABELED if there are annotations
      const newStatus = parsedAnns.length > 0 ? 'LABELED' : 'UNLABELED';
      await db.updateImageStatus(imageId, newStatus);

      // Update local images state to reflect the new status
      setImages(prevImages =>
        prevImages.map(img =>
          img.id === imageId ? { ...img, status: newStatus } : img
        )
      );

      console.log("Saved successfully.");
      if (showAlert) {
        alert("Annotations Saved!");
      }
    } catch (error) {
      console.error("Failed to save annotations:", error);
      if (showAlert) {
        alert(`Error saving annotations: ${error}`);
      }
    }
  }, [annotations, imageId, projectId, selectedClassId, classes]);

  const handleExport = useCallback(async () => {
    if (!projectId) return;
    try {
      // Let user select export folder
      const exportFolder = await open({
        directory: true,
        title: 'Select Export Folder'
      });

      if (!exportFolder || typeof exportFolder !== 'string') {
        return; // User cancelled
      }

      // Auto-split dataset before exporting (70% train, 20% val, 10% test)
      console.log("Splitting dataset...");
      const splitResult = await db.autoSplitDataset(projectId, {
        train: 0.7,
        val: 0.2,
        test: 0.1
      });
      console.log("Split result:", splitResult);

      const result = await db.exportDataset(projectId, exportFolder);
      console.log("Export result:", result);
      alert(`Exported ${result.count} images to:\n${exportFolder}\n\nSplit:\n- Train: ${splitResult.train} images\n- Val: ${splitResult.val} images\n- Test: ${splitResult.test} images\n\nStructure:\n- images/train/\n- images/val/\n- images/test/\n- labels/train/\n- labels/val/\n- labels/test/\n- data.yaml`);
    } catch (error) {
      console.error("Failed to export dataset:", error);
      alert(`Error exporting dataset: ${error}`);
    }
  }, [projectId]);

  const handleImportImages = useCallback(async () => {
    if (!projectId) return;

    try {
      const files = await open({
        multiple: true,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
        }]
      });

      if (files) {
        // Tauri 2 dialog returns strings directly (file paths)
        const paths = Array.isArray(files) ? files : [files];
        await db.addImages(projectId, paths as string[]);

        // Refresh images list
        const imagesList = await db.getImages(projectId);
        setImages(imagesList);
        if (imagesList.length > 0 && !imageId) {
          const firstImage = imagesList[0];
          setImageId(firstImage.id);
          setImageSrc(firstImage.file_path);
          setCurrentImageIndex(0);
          const anns = await db.getAnnotations(firstImage.id);

          // Parse coordinates from JSON string
          const parsedAnns = anns.map(ann => {
            try {
              const coords = JSON.parse(ann.coordinates);
              return {
                ...ann,
                ...coords,
                color: classes.find(c => c.id === ann.label_id)?.color || '#00ff00'
              };
            } catch (e) {
              console.error("Failed to parse annotation coordinates:", e);
              return ann;
            }
          });

          setAnnotations(parsedAnns);
        }

        alert(`Imported ${paths.length} images`);
      }
    } catch (error) {
      console.error("Failed to import images:", error);
      alert(`Error importing images: ${error}`);
    }
  }, [projectId, imageId, classes]);

  const handleImportFolder = useCallback(async () => {
    if (!projectId) return;

    try {
      const folder = await open({
        directory: true
      });

      if (folder && typeof folder === 'string') {
        console.log("Scanning folder:", folder);

        // Scan folder for image files
        const imagePaths = await db.scanFolderForImages(folder);

        if (imagePaths.length === 0) {
          alert('No image files found in the selected folder.');
          return;
        }

        // Add all images to the project
        await db.addImages(projectId, imagePaths);

        // Refresh images list
        const imagesList = await db.getImages(projectId);
        setImages(imagesList);

        if (imagesList.length > 0 && !imageId) {
          const firstImage = imagesList[0];
          setImageId(firstImage.id);
          setImageSrc(firstImage.file_path);
          setCurrentImageIndex(0);
          const anns = await db.getAnnotations(firstImage.id);

          // Parse coordinates from JSON string
          const parsedAnns = anns.map(ann => {
            try {
              const coords = JSON.parse(ann.coordinates);
              return {
                ...ann,
                ...coords,
                color: classes.find(c => c.id === ann.label_id)?.color || '#00ff00'
              };
            } catch (e) {
              console.error("Failed to parse annotation coordinates:", e);
              return ann;
            }
          });

          setAnnotations(parsedAnns);
        }

        alert(`Imported ${imagePaths.length} images from folder`);
      }
    } catch (error) {
      console.error("Failed to import folder:", error);
      alert(`Error importing folder: ${error}`);
    }
  }, [projectId, imageId, classes]);

  const loadImage = useCallback(async (index: number) => {
    if (index < 0 || index >= images.length) return;

    // Auto-save current annotations before switching images
    if (imageId && annotations.length > 0) {
      await handleSave(false); // Don't show alert for auto-save
    }

    const image = images[index];
    setCurrentImageIndex(index);
    setImageId(image.id);
    setImageSrc(image.file_path);

    // Clear annotations immediately to prevent carryover from previous image
    setAnnotations([]);
    setSelectedAnnotationId(null);

    // Load annotations for this image
    const anns = await db.getAnnotations(image.id);

    // Parse coordinates from JSON string
    const parsedAnns = anns.map(ann => {
      try {
        const coords = JSON.parse(ann.coordinates);
        return {
          ...ann,
          ...coords,
          color: classes.find(c => c.id === ann.label_id)?.color || '#00ff00'
        };
      } catch (e) {
        console.error("Failed to parse annotation coordinates:", e);
        return ann;
      }
    });

    setAnnotations(parsedAnns);
  }, [images, imageId, annotations, handleSave, classes]);

  const handlePrevImage = useCallback(() => {
    if (currentImageIndex > 0) {
      loadImage(currentImageIndex - 1);
    }
  }, [currentImageIndex, loadImage]);

  const handleNextImage = useCallback(() => {
    if (currentImageIndex < images.length - 1) {
      loadImage(currentImageIndex + 1);
    }
  }, [currentImageIndex, images.length, loadImage]);

  const handleDeleteAnnotation = useCallback(async () => {
    if (!selectedAnnotationId) {
      console.log("No annotation selected for deletion");
      return;
    }

    try {
      console.log("Attempting to delete annotation:", selectedAnnotationId);
      console.log("Current annotations:", annotations);

      // Find the annotation to delete - check both id and tempId
      const annToDelete = annotations.find(ann => {
        const annId = ann.id?.toString() || ann.tempId || '';
        const match = annId === selectedAnnotationId;
        console.log(`Comparing ${annId} === ${selectedAnnotationId}: ${match}`);
        return match;
      });

      if (!annToDelete) {
        console.error("Annotation not found in list:", selectedAnnotationId);
        alert("Annotation not found. Please try selecting it again.");
        setSelectedAnnotationId(null);
        return;
      }

      console.log("Found annotation to delete:", annToDelete);

      // If it has a database ID, delete from database
      if (typeof annToDelete.id === 'number') {
        console.log("Deleting from database, ID:", annToDelete.id);
        await db.deleteAnnotation(annToDelete.id);
        console.log("Deleted from database successfully");
      }

      // Remove from local state
      let remainingCount = 0;
      setAnnotations(prevAnnotations => {
        const filtered = prevAnnotations.filter(ann => {
          const annId = ann.id?.toString() || ann.tempId || '';
          return annId !== selectedAnnotationId;
        });
        console.log("Filtered annotations:", filtered);
        remainingCount = filtered.length;
        return filtered;
      });

      // Update image status if this was the last annotation
      if (imageId && remainingCount === 0) {
        await db.updateImageStatus(imageId, 'UNLABELED');
        setImages(prevImages =>
          prevImages.map(img =>
            img.id === imageId ? { ...img, status: 'UNLABELED' } : img
          )
        );
      }

      setSelectedAnnotationId(null);
      console.log("Annotation deleted successfully");
    } catch (error) {
      console.error("Failed to delete annotation:", error);
      alert(`Error deleting annotation: ${error}`);
    }
  }, [selectedAnnotationId, annotations, imageId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default for handled shortcuts
      const handled = ['ArrowLeft', 'ArrowRight', 'Delete', 'Escape'].includes(e.key) ||
        (e.key === 's' && (e.ctrlKey || e.metaKey));

      if (handled) {
        e.preventDefault();
      }

      // Arrow keys for navigation
      if (e.key === 'ArrowLeft') {
        handlePrevImage();
      } else if (e.key === 'ArrowRight') {
        handleNextImage();
      }

      // Delete key to remove selected annotation
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteAnnotation();
      }

      // Escape to deselect
      else if (e.key === 'Escape') {
        setSelectedAnnotationId(null);
      }

      // Ctrl/Cmd+S to save
      else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        handleSave();
      }

      // Number keys 1-9 for class selection
      else if (e.key >= '1' && e.key <= '9') {
        const classIndex = parseInt(e.key) - 1;
        if (classIndex < classes.length) {
          setSelectedClassId(classes[classIndex].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevImage, handleNextImage, handleDeleteAnnotation, handleSave, classes]);

  const handleAutoDetect = useCallback(async () => {
    if (!imageSrc || !imageId) return;

    try {
      console.log("Running YOLO detection on:", imageSrc);
      const result = await db.runYoloDetection(imageSrc);

      // Convert YOLO detections to annotations
      const newAnnotations = result.detections.map((det, idx) => {
        // YOLO returns [x_center, y_center, width, height] in absolute coords
        const [xCenter, yCenter, width, height] = det.bbox;
        return {
          id: `yolo_${Date.now()}_${idx}`,
          x: xCenter - width / 2,
          y: yCenter - height / 2,
          width,
          height,
          label_id: det.class_id,
          color: classes.find(c => c.id === det.class_id)?.color || '#00ff00',
          source: 'model',
          confidence: det.confidence
        };
      });

      setAnnotations(prev => [...prev, ...newAnnotations]);
      alert(`Detected ${newAnnotations.length} objects!`);
    } catch (err) {
      console.error("Auto-detection failed:", err);
      alert(`Auto-detection failed: ${err}`);
    }
  }, [imageSrc, imageId, classes]);

  const handleValidate = useCallback(async () => {
    if (!projectId) return;

    try {
      console.log("Validating project...");
      const result = await db.validateProject(projectId);
      setValidationResult(result);
      setShowValidationModal(true);
    } catch (err) {
      console.error("Validation failed:", err);
      alert(`Validation failed: ${err}`);
    }
  }, [projectId]);

  if (isLoading) {
    return <div className="h-screen w-screen bg-neutral-900 text-white flex items-center justify-center">Loading...</div>;
  }

  // Show project selection if no project is loaded
  if (!projectId) {
    return <ProjectSelector onSelectProject={loadProject} onCreateProject={createNewProject} />;
  }

  return (
    <div className="h-screen w-screen bg-background text-foreground overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="h-12 bg-neutral-800 border-b border-neutral-700 flex items-center px-4 space-x-4">
        <h1 className="text-white font-bold mr-4">Arduron Labeler</h1>

        {/* Class Selector */}
        <ClassSelector
          classes={classes}
          selectedClassId={selectedClassId}
          onClassSelect={setSelectedClassId}
          onClassesChange={setClasses}
        />

        <div className="flex-1" /> {/* Spacer */}

        {/* Image Navigation */}
        <div className="flex items-center space-x-2 bg-neutral-900 px-3 py-1.5 rounded">
          <button
            onClick={handlePrevImage}
            disabled={currentImageIndex === 0}
            className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm transition-colors"
          >
            ←
          </button>
          <span className="text-white text-sm">
            {currentImageIndex + 1} / {images.length}
          </span>
          <button
            onClick={handleNextImage}
            disabled={currentImageIndex >= images.length - 1}
            className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm transition-colors"
          >
            →
          </button>
        </div>

        <button
          onClick={handleAutoDetect}
          className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm transition-colors"
        >
          Auto-Detect
        </button>
        <button
          onClick={handleImportImages}
          className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm transition-colors"
        >
          Import Images
        </button>
        <button
          onClick={handleImportFolder}
          className="px-4 py-1.5 bg-green-700 hover:bg-green-800 text-white rounded text-sm transition-colors"
        >
          Import Folder
        </button>
        <button
          onClick={() => handleSave()}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors"
        >
          Save
        </button>
        <button
          onClick={handleValidate}
          className="px-4 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm transition-colors"
        >
          Validate
        </button>
        <button
          onClick={handleExport}
          className="px-4 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-white rounded text-sm transition-colors"
        >
          Export (YOLO)
        </button>
        <span className="text-neutral-500 text-xs ml-auto">
          {annotations.length} annotations
        </span>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 overflow-hidden relative">
        <CanvasStage
          imageSrc={imageSrc}
          annotations={annotations}
          onAnnotationsChange={(newAnnotations) => {
            // Assign selected class to new annotations
            const annotationsWithClass = newAnnotations.map(ann => ({
              ...ann,
              label_id: ann.label_id ?? selectedClassId,
              color: classes.find(c => c.id === (ann.label_id ?? selectedClassId))?.color || '#00ff00'
            }));
            setAnnotations(annotationsWithClass);
          }}
          selectedClass={classes.find(c => c.id === selectedClassId)}
          selectedAnnotationId={selectedAnnotationId}
          onAnnotationSelect={setSelectedAnnotationId}
          onDeleteAnnotation={handleDeleteAnnotation}
        />
      </div>

      {/* Validation Modal */}
      {showValidationModal && validationResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-neutral-800 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className={`px-4 py-3 border-b border-neutral-700 flex items-center justify-between ${validationResult.valid ? 'bg-green-900/50' : 'bg-yellow-900/50'}`}>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                Validation Results {validationResult.valid ? '(Valid)' : '(Issues Found)'}
              </h2>
              <button
                onClick={() => setShowValidationModal(false)}
                className="text-neutral-400 hover:text-white text-xl"
              >
                &times;
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-neutral-900 rounded p-3">
                  <div className="text-sm text-neutral-400">Total Images</div>
                  <div className="text-xl font-bold text-white">{validationResult.stats.total_images}</div>
                </div>
                <div className="bg-neutral-900 rounded p-3">
                  <div className="text-sm text-neutral-400">Labeled</div>
                  <div className="text-xl font-bold text-green-400">{validationResult.stats.labeled_images}</div>
                </div>
                <div className="bg-neutral-900 rounded p-3">
                  <div className="text-sm text-neutral-400">Unlabeled</div>
                  <div className="text-xl font-bold text-yellow-400">{validationResult.stats.unlabeled_images}</div>
                </div>
                <div className="bg-neutral-900 rounded p-3">
                  <div className="text-sm text-neutral-400">Annotations</div>
                  <div className="text-xl font-bold text-white">{validationResult.stats.total_annotations}</div>
                </div>
              </div>

              {/* Issues */}
              {validationResult.issues.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold text-neutral-400 mb-2">Issues ({validationResult.issues.length})</h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {validationResult.issues.map((issue, idx) => (
                      <div
                        key={idx}
                        className={`p-2 rounded text-sm ${issue.severity === 'error' ? 'bg-red-900/30 text-red-300' :
                            issue.severity === 'warning' ? 'bg-yellow-900/30 text-yellow-300' :
                              'bg-blue-900/30 text-blue-300'
                          }`}
                      >
                        <span className="font-medium uppercase text-xs">
                          [{issue.severity}]
                        </span>{' '}
                        {issue.message}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-green-400">
                  No issues found! Dataset is ready for export.
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-neutral-700 flex justify-end gap-2">
              <button
                onClick={() => setShowValidationModal(false)}
                className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded text-sm"
              >
                Close
              </button>
              {validationResult.valid && (
                <button
                  onClick={() => {
                    setShowValidationModal(false);
                    handleExport();
                  }}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                >
                  Export Dataset
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
