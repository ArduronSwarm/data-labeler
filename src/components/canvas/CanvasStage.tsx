import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Stage } from 'react-konva';
import Konva from 'konva';
import { BackgroundLayer } from './BackgroundLayer';
import { ActiveLayer } from './ActiveLayer';

interface ClassDefinition {
    id: number;
    name: string;
    color: string;
}

interface CanvasStageProps {
    imageSrc: string | null;
    annotations: any[];
    onAnnotationsChange: (annotations: any[]) => void;
    selectedClass?: ClassDefinition | null;
    selectedAnnotationId?: string | null;
    onAnnotationSelect?: (id: string | null) => void;
    onDeleteAnnotation?: () => void;
}

export const CanvasStage: React.FC<CanvasStageProps> = ({ 
    imageSrc, 
    annotations, 
    onAnnotationsChange, 
    selectedClass,
    selectedAnnotationId,
    onAnnotationSelect,
    onDeleteAnnotation: _onDeleteAnnotation  // Reserved for future canvas-level delete handling
}) => {
    const stageRef = useRef<Konva.Stage>(null);
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [stageSize, setStageSize] = useState({
        width: window.innerWidth,
        height: window.innerHeight,
    });
    const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
    const lastFittedImageRef = useRef<string | null>(null);

    // Drawing State (local)
    const [newAnnotation, setNewAnnotation] = useState<any[]>([]);
    const [isDrawing, setIsDrawing] = useState(false);

    useEffect(() => {
        const handleResize = () => {
            setStageSize({
                width: window.innerWidth,
                height: window.innerHeight,
            });
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Function to fit and center image on canvas
    const fitImageToCanvas = (imageWidth: number, imageHeight: number) => {
        const padding = 50; // Padding around the image
        const availableWidth = stageSize.width - padding * 2;
        const availableHeight = stageSize.height - padding * 2;

        // Calculate scale to fit image in viewport
        const scaleX = availableWidth / imageWidth;
        const scaleY = availableHeight / imageHeight;
        const newScale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 100%

        // Calculate position to center the image
        const scaledWidth = imageWidth * newScale;
        const scaledHeight = imageHeight * newScale;
        const newPosition = {
            x: (stageSize.width - scaledWidth) / 2,
            y: (stageSize.height - scaledHeight) / 2,
        };

        setScale(newScale);
        setPosition(newPosition);
    };

    // Auto-fit when image changes or loads, or when stage size changes
    useEffect(() => {
        if (imageDimensions && imageSrc) {
            // Re-fit if image changed OR if this is the first fit for this image
            const shouldFit = lastFittedImageRef.current !== imageSrc;
            if (shouldFit) {
                fitImageToCanvas(imageDimensions.width, imageDimensions.height);
                lastFittedImageRef.current = imageSrc;
            }
        }
    }, [imageSrc, imageDimensions, stageSize]);

    const handleImageLoad = useCallback((width: number, height: number) => {
        setImageDimensions({ width, height });
    }, []);

    const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
        e.evt.preventDefault();
        const stage = stageRef.current;
        if (!stage) return;

        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const scaleBy = 1.1;
        const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;

        if (newScale < 0.1 || newScale > 20) return;

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };

        const newPos = {
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        };

        setScale(newScale);
        setPosition(newPos);
    };

    const getRelativePointerPosition = (node: Konva.Node, clamp: boolean = false) => {
        const transform = node.getAbsoluteTransform().copy();
        transform.invert();
        const pos = node.getStage()?.getPointerPosition();
        if (!pos) return null;

        const point = transform.point(pos);

        // Clamp to image boundaries if requested and image dimensions are known
        if (clamp && imageDimensions) {
            point.x = Math.max(0, Math.min(point.x, imageDimensions.width));
            point.y = Math.max(0, Math.min(point.y, imageDimensions.height));
        }

        return point;
    };

    const isWithinImageBounds = (x: number, y: number): boolean => {
        if (!imageDimensions) return true;
        return x >= 0 && x <= imageDimensions.width &&
               y >= 0 && y <= imageDimensions.height;
    };

    const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (e.evt.button === 1 || e.evt.ctrlKey) {
            return;
        }

        // If clicking on a shape (Rect or Transformer), let Konva handle it
        const target = e.target;
        if (target.getClassName() === 'Rect' || target.getClassName() === 'Transformer') {
            // Clicking on an annotation or transformer - don't start drawing
            return;
        }

        const stage = e.target.getStage();
        if (!stage) return;
        const pos = getRelativePointerPosition(stage);
        if (!pos) return;

        // Don't allow clicking outside image boundaries
        if (!isWithinImageBounds(pos.x, pos.y)) {
            return;
        }

        // Check if clicking on an existing annotation (with padding for easier selection)
        const hitPadding = 5 / scale; // 5px padding adjusted for zoom
        const clickedAnnotation = annotations.find(ann => {
            return pos.x >= ann.x - hitPadding &&
                   pos.x <= ann.x + ann.width + hitPadding &&
                   pos.y >= ann.y - hitPadding &&
                   pos.y <= ann.y + ann.height + hitPadding;
        });

        if (clickedAnnotation) {
            // Select the annotation using id or tempId
            const annotationId = clickedAnnotation.id?.toString() || clickedAnnotation.tempId || null;
            onAnnotationSelect?.(annotationId);
            return;
        }

        // Deselect if clicking on empty space
        onAnnotationSelect?.(null);

        // Don't allow drawing if no class is selected
        if (!selectedClass) {
            console.warn("No class selected - cannot create annotation");
            return;
        }

        setIsDrawing(true);
        setNewAnnotation([{
            x: pos.x,
            y: pos.y,
            width: 0,
            height: 0,
            // Use temp ID for client-side tracking (will be excluded when saving to DB)
            tempId: `temp_${Date.now()}`
        }]);
    };

    const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (!isDrawing || newAnnotation.length === 0) return;

        const stage = e.target.getStage();
        if (!stage) return;
        // Use clamped position to keep annotation within image bounds
        const pos = getRelativePointerPosition(stage, true);
        if (!pos) return;

        const startX = newAnnotation[0].x;
        const startY = newAnnotation[0].y;

        setNewAnnotation([{
            ...newAnnotation[0],
            width: pos.x - startX,
            height: pos.y - startY
        }]);
    };

    const handleMouseUp = () => {
        if (!isDrawing) return;
        setIsDrawing(false);

        if (newAnnotation.length === 0) return;

        const rect = newAnnotation[0];
        const tempId = `temp_${Date.now()}`;
        const normalized = {
            tempId,
            x: rect.width < 0 ? rect.x + rect.width : rect.x,
            y: rect.height < 0 ? rect.y + rect.height : rect.y,
            width: Math.abs(rect.width),
            height: Math.abs(rect.height),
        };

        if (normalized.width > 2 && normalized.height > 2) {
            onAnnotationsChange([...annotations, normalized]);
            // Auto-select the newly created annotation
            onAnnotationSelect?.(tempId);
        }
        setNewAnnotation([]);
    };

    return (
        <div className="w-full h-full bg-neutral-900 overflow-hidden">
            <Stage
                ref={stageRef}
                width={stageSize.width}
                height={stageSize.height}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                scaleX={scale}
                scaleY={scale}
                x={position.x}
                y={position.y}
                draggable={!isDrawing}
            >
                <BackgroundLayer imageSrc={imageSrc} onImageLoad={handleImageLoad} />
                <ActiveLayer
                    annotations={annotations}
                    newAnnotation={newAnnotation.length > 0 ? newAnnotation[0] : null}
                    scale={scale}
                    selectedColor={selectedClass?.color || '#00ff00'}
                    selectedAnnotationId={selectedAnnotationId || null}
                    onAnnotationChange={(id, changes) => {
                        // Update the annotation with new coordinates
                        const updatedAnnotations = annotations.map(ann => {
                            const annId = ann.id?.toString() || ann.tempId;
                            if (annId === id) {
                                return { ...ann, ...changes };
                            }
                            return ann;
                        });
                        onAnnotationsChange(updatedAnnotations);
                    }}
                    onAnnotationSelect={onAnnotationSelect}
                />
            </Stage>

            <div className="absolute top-4 left-4 bg-black/70 p-3 rounded text-white text-xs pointer-events-none select-none">
                <p className="font-bold mb-2">Controls</p>
                {!selectedClass && (
                    <p className="text-yellow-400 mb-2">⚠️ Select a class to start labeling</p>
                )}
                <p>Scroll: Zoom</p>
                <p>Drag Canvas: Pan</p>
                <p>Click+Drag: Draw Box</p>
                <p>Click Box: Select</p>
                <p className="text-green-400">Drag Selected: Move</p>
                <p className="text-green-400">Drag Corners: Resize</p>
                <p>Arrow Keys: Navigate Images</p>
                <p>Delete: Remove Selected</p>
                <p>Esc: Deselect</p>
                <p>Ctrl/Cmd+S: Save</p>
                <p>1-9: Select Class</p>
                <p className="mt-2 text-neutral-400">Zoom: {scale.toFixed(2)}x</p>
            </div>
        </div>
    );
};
