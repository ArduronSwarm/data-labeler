import { invoke } from '@tauri-apps/api/core';

export interface Project {
  id: number;
  name: string;
  ontology: string;
  created_at: string;
}

export interface Image {
  id: number;
  project_id: number;
  file_path: string;
  width?: number;
  height?: number;
  status: string;
  split_set?: string;
}

export interface Annotation {
  id?: number;
  image_id: number;
  label_id: number;
  geometry_type: string;
  coordinates: string;
  source: string;
}

export interface SplitRatios {
  train: number;
  val: number;
  test: number;
}

export interface SplitResult {
  total: number;
  train: number;
  val: number;
  test: number;
}

export interface ExportResult {
  success: boolean;
  count: number;
}

export interface Detection {
  class_id: number;
  confidence: number;
  bbox: number[]; // [x_center, y_center, width, height]
}

export interface YoloResponse {
  detections: Detection[];
}

export interface ValidationIssue {
  severity: string;
  message: string;
  image_id?: number;
}

export interface ValidationStats {
  total_images: number;
  labeled_images: number;
  unlabeled_images: number;
  total_annotations: number;
  missing_dimensions: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  stats: ValidationStats;
}

export const db = {
  getProject: (id: number): Promise<Project | null> =>
    invoke('get_project', { id }),
  
  getAllProjects: (): Promise<Project[]> =>
    invoke('get_all_projects'),
  
  createProject: (name: string, ontology: string): Promise<number> =>
    invoke('create_project', { name, ontology }),

  deleteProject: (id: number): Promise<void> =>
    invoke('delete_project', { id }),

  updateProject: (id: number, name: string, ontology: string): Promise<void> =>
    invoke('update_project', { id, name, ontology }),

  getImages: (projectId: number): Promise<Image[]> =>
    invoke('get_images', { projectId }),

  addImage: (projectId: number, filePath: string): Promise<number> =>
    invoke('add_image', { projectId, filePath }),

  addImages: (projectId: number, filePaths: string[]): Promise<number> =>
    invoke('add_images', { projectId, filePaths }),

  getAnnotations: (imageId: number): Promise<Annotation[]> =>
    invoke('get_annotations', { imageId }),
  
  saveAnnotation: (annotation: Annotation): Promise<number> =>
    invoke('save_annotation', { annotation }),
  
  deleteAnnotation: (id: number): Promise<void> =>
    invoke('delete_annotation', { id }),
  
  updateImageStatus: (imageId: number, status: string): Promise<void> =>
    invoke('update_image_status', { imageId, status }),

  autoSplitDataset: (projectId: number, ratios: SplitRatios): Promise<SplitResult> =>
    invoke('auto_split_dataset', { projectId, ratios }),

  exportDataset: (projectId: number, exportPath: string): Promise<ExportResult> =>
    invoke('export_dataset', { projectId, exportPath }),
  
  startPythonServer: (): Promise<string> =>
    invoke('start_python_server'),
  
  stopPythonServer: (): Promise<string> =>
    invoke('stop_python_server'),
  
  runYoloDetection: (imagePath: string): Promise<YoloResponse> =>
    invoke('run_yolo_detection', { imagePath }),

  validateProject: (projectId: number): Promise<ValidationResult> =>
    invoke('validate_project', { projectId }),

  scanFolderForImages: (folderPath: string): Promise<string[]> =>
    invoke('scan_folder_for_images', { folderPath }),
};
