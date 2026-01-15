use crate::database::{Annotation, Database};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tauri::async_runtime::Mutex;

#[derive(Debug, Serialize, Deserialize)]
pub struct BboxCoordinates {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SplitRatios {
    pub train: f64,
    pub val: f64,
    pub test: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SplitResult {
    pub total: i64,
    pub train: i64,
    pub val: i64,
    pub test: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportResult {
    pub success: bool,
    pub count: usize,
}

fn get_db(app: &AppHandle) -> Result<Database, String> {
    let db_path = app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("arduron.db");
    
    std::fs::create_dir_all(db_path.parent().unwrap()).map_err(|e| e.to_string())?;
    
    Database::new(db_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_project(app: AppHandle, id: i64) -> Result<Option<crate::database::Project>, String> {
    let db = get_db(&app)?;
    db.get_project(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_projects(app: AppHandle) -> Result<Vec<crate::database::Project>, String> {
    let db = get_db(&app)?;
    db.get_all_projects().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_project(app: AppHandle, name: String, ontology: String) -> Result<i64, String> {
    let db = get_db(&app)?;
    db.create_project(name, ontology).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_project(app: AppHandle, id: i64) -> Result<(), String> {
    let db = get_db(&app)?;
    db.delete_project(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_project(app: AppHandle, id: i64, name: String, ontology: String) -> Result<(), String> {
    let db = get_db(&app)?;
    db.update_project(id, name, ontology).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_images(app: AppHandle, project_id: i64) -> Result<Vec<crate::database::Image>, String> {
    let db = get_db(&app)?;
    db.get_images(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_image(app: AppHandle, project_id: i64, file_path: String) -> Result<i64, String> {
    let db = get_db(&app)?;
    db.add_image(project_id, file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_images(app: AppHandle, project_id: i64, file_paths: Vec<String>) -> Result<usize, String> {
    let db = get_db(&app)?;
    db.add_images(project_id, file_paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_annotations(app: AppHandle, image_id: i64) -> Result<Vec<Annotation>, String> {
    let db = get_db(&app)?;
    db.get_annotations(image_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_annotation(app: AppHandle, annotation: Annotation) -> Result<i64, String> {
    let db = get_db(&app)?;
    db.save_annotation(annotation).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_annotation(app: AppHandle, id: i64) -> Result<(), String> {
    let db = get_db(&app)?;
    db.delete_annotation(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_image_status(app: AppHandle, image_id: i64, status: String) -> Result<(), String> {
    let db = get_db(&app)?;
    db.update_image_status(image_id, status).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn auto_split_dataset(app: AppHandle, project_id: i64, ratios: SplitRatios) -> Result<SplitResult, String> {
    let db = get_db(&app)?;
    let (train, val, test) = db.auto_split_dataset(project_id, ratios.train, ratios.val)
        .map_err(|e| e.to_string())?;
    
    Ok(SplitResult {
        total: train + val + test,
        train,
        val,
        test,
    })
}

#[derive(Debug, serde::Deserialize)]
struct OntologyClass {
    id: i64,
    name: String,
    #[allow(dead_code)]
    color: String,
}

#[tauri::command]
pub fn export_dataset(app: AppHandle, project_id: i64, export_path: String) -> Result<ExportResult, String> {
    let db = get_db(&app)?;
    let images = db.get_images(project_id).map_err(|e| e.to_string())?;

    // Get project ontology for class names
    let project = db.get_project(project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;

    let export_path = PathBuf::from(export_path);
    
    // Create directory structure
    for split in &["train", "val", "test"] {
        std::fs::create_dir_all(export_path.join("images").join(split))
            .map_err(|e| e.to_string())?;
        std::fs::create_dir_all(export_path.join("labels").join(split))
            .map_err(|e| e.to_string())?;
    }
    
    // Export images and labels
    for img in &images {
        let split = img.split_set.as_deref().unwrap_or("train");
        if !["train", "val", "test"].contains(&split) {
            continue;
        }
        
        let src_path = PathBuf::from(&img.file_path);
        if !src_path.exists() {
            continue;
        }
        
        let file_name = src_path.file_name().ok_or("Invalid filename")?;
        let dest_path = export_path.join("images").join(split).join(file_name);
        std::fs::copy(&src_path, dest_path).map_err(|e| e.to_string())?;
        
        // Export annotations
        let annotations = db.get_annotations(img.id).map_err(|e| e.to_string())?;
        let stem = src_path.file_stem().ok_or("Invalid file stem")?;
        let label_path = export_path.join("labels").join(split).join(format!("{}.txt", stem.to_string_lossy()));
        
        // Get image dimensions
        let img_width = img.width.ok_or("Image width not available")? as f64;
        let img_height = img.height.ok_or("Image height not available")? as f64;
        
        // Convert annotations to YOLO format
        let label_content: Vec<String> = annotations.iter().filter_map(|a| {
            // Parse coordinates JSON
            let coords: BboxCoordinates = serde_json::from_str(&a.coordinates).ok()?;
            
            // Convert to YOLO format: class x_center y_center width height (normalized 0-1)
            let x_center = (coords.x + coords.width / 2.0) / img_width;
            let y_center = (coords.y + coords.height / 2.0) / img_height;
            let norm_width = coords.width / img_width;
            let norm_height = coords.height / img_height;
            
            Some(format!("{} {:.6} {:.6} {:.6} {:.6}", 
                a.label_id, x_center, y_center, norm_width, norm_height))
        }).collect();
        
        std::fs::write(label_path, label_content.join("\n")).map_err(|e| e.to_string())?;
    }
    
    // Create data.yaml with actual class names from ontology
    let ontology: Vec<OntologyClass> = serde_json::from_str(&project.ontology)
        .map_err(|e| format!("Failed to parse ontology: {}", e))?;

    // Sort classes by ID to ensure correct ordering
    let mut sorted_classes = ontology;
    sorted_classes.sort_by_key(|c| c.id);

    // Create class names list in YAML format
    let class_names: Vec<String> = sorted_classes.iter()
        .map(|c| format!("'{}'", c.name))
        .collect();
    let names_str = class_names.join(", ");

    let yaml_content = format!(
        "# Arduron Data Labeling Export\n\n\
         train: ./images/train\n\
         val: ./images/val\n\
         test: ./images/test\n\n\
         nc: {}\n\
         names: [{}]\n",
        sorted_classes.len(),
        names_str
    );
    std::fs::write(export_path.join("data.yaml"), yaml_content).map_err(|e| e.to_string())?;
    
    Ok(ExportResult {
        success: true,
        count: images.len(),
    })
}

#[tauri::command]
pub async fn start_python_server(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    
    // Get the Python executable from the virtual environment
    let python_path = if cfg!(target_os = "windows") {
        ".venv/Scripts/python.exe"
    } else {
        ".venv/bin/python"
    };
    
    // Spawn the Python server
    let sidecar = app.shell()
        .command(python_path)
        .args(["python/main.py"])
        .spawn()
        .map_err(|e| format!("Failed to spawn Python server: {}", e))?;
    
    // Store the child process in app state for cleanup
    app.manage(Arc::new(Mutex::new(Some(sidecar))));
    
    Ok("Python server started on port 5555".to_string())
}

#[tauri::command]
pub async fn stop_python_server(app: AppHandle) -> Result<String, String> {
    // Send SHUTDOWN signal via ZeroMQ
    let client = reqwest::Client::new();
    let _ = client
        .post("http://localhost:5555")
        .json(&serde_json::json!({ "command": "SHUTDOWN" }))
        .send()
        .await;
    
    // Kill the process if it exists
    if let Some(process) = app.try_state::<Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>>() {
        if let Some(child) = process.lock().await.take() {
            let _ = child.kill();
        }
    }
    
    Ok("Python server stopped".to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Detection {
    pub class_id: i64,
    pub confidence: f64,
    pub bbox: Vec<f64>, // [x_center, y_center, width, height]
}

#[derive(Debug, Serialize, Deserialize)]
pub struct YoloResponse {
    pub detections: Vec<Detection>,
}

#[tauri::command]
pub async fn run_yolo_detection(app: AppHandle, image_path: String) -> Result<YoloResponse, String> {
    use tauri_plugin_shell::ShellExt;
    
    // Get the Python executable from the virtual environment
    let python_path = if cfg!(target_os = "windows") {
        ".venv/Scripts/python.exe"
    } else {
        ".venv/bin/python"
    };
    
    // Run the prediction script
    let output = app.shell()
        .command(python_path)
        .args(["python/predict.py", "yolo", &image_path])
        .output()
        .await
        .map_err(|e| format!("Failed to run prediction: {}", e))?;
    
    if !output.status.success() {
        return Err(format!("Prediction failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;
    
    if let Some(error) = result.get("error") {
        return Err(format!("Python error: {}", error));
    }
    
    let detections_json = result["detections"]
        .as_array()
        .ok_or("Invalid response format")?;
    
    let detections: Vec<Detection> = detections_json
        .iter()
        .filter_map(|d| {
            Some(Detection {
                class_id: d["class"].as_i64()?,
                confidence: d["conf"].as_f64()?,
                bbox: d["bbox"].as_array()?.iter().filter_map(|v| v.as_f64()).collect(),
            })
        })
        .collect();
    
    Ok(YoloResponse { detections })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub severity: String, // "warning" or "error"
    pub message: String,
    pub image_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub issues: Vec<ValidationIssue>,
    pub stats: ValidationStats,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationStats {
    pub total_images: usize,
    pub labeled_images: usize,
    pub unlabeled_images: usize,
    pub total_annotations: usize,
    pub missing_dimensions: usize,
}

#[tauri::command]
pub fn validate_project(app: AppHandle, project_id: i64) -> Result<ValidationResult, String> {
    let db = get_db(&app)?;
    let images = db.get_images(project_id).map_err(|e| e.to_string())?;
    
    let mut issues: Vec<ValidationIssue> = Vec::new();
    let mut total_annotations = 0;
    let mut labeled_images = 0;
    let mut unlabeled_images = 0;
    let mut missing_dimensions = 0;
    
    for img in &images {
        // Check for missing dimensions
        if img.width.is_none() || img.height.is_none() {
            missing_dimensions += 1;
            issues.push(ValidationIssue {
                severity: "warning".to_string(),
                message: format!("Image missing dimensions: {}", img.file_path),
                image_id: Some(img.id),
            });
        }
        
        // Check if file exists
        let path = std::path::Path::new(&img.file_path);
        if !path.exists() && !img.file_path.starts_with("http") {
            issues.push(ValidationIssue {
                severity: "error".to_string(),
                message: format!("Image file not found: {}", img.file_path),
                image_id: Some(img.id),
            });
        }
        
        // Get annotations for this image
        let annotations = db.get_annotations(img.id).map_err(|e| e.to_string())?;
        total_annotations += annotations.len();
        
        if annotations.is_empty() {
            unlabeled_images += 1;
            issues.push(ValidationIssue {
                severity: "warning".to_string(),
                message: format!("Image has no annotations: {}", img.file_path),
                image_id: Some(img.id),
            });
        } else {
            labeled_images += 1;
            
            // Check for overlapping annotations (simple IoU check)
            for (i, ann1) in annotations.iter().enumerate() {
                for ann2 in annotations.iter().skip(i + 1) {
                    if let (Ok(coords1), Ok(coords2)) = (
                        serde_json::from_str::<BboxCoordinates>(&ann1.coordinates),
                        serde_json::from_str::<BboxCoordinates>(&ann2.coordinates),
                    ) {
                        let iou = compute_iou(&coords1, &coords2);
                        if iou > 0.9 {
                            issues.push(ValidationIssue {
                                severity: "warning".to_string(),
                                message: format!("Near-duplicate annotations detected (IoU: {:.2})", iou),
                                image_id: Some(img.id),
                            });
                        }
                    }
                }
            }
        }
    }
    
    let valid = issues.iter().filter(|i| i.severity == "error").count() == 0;
    
    Ok(ValidationResult {
        valid,
        issues,
        stats: ValidationStats {
            total_images: images.len(),
            labeled_images,
            unlabeled_images,
            total_annotations,
            missing_dimensions,
        },
    })
}

#[tauri::command]
pub fn scan_folder_for_images(folder_path: String) -> Result<Vec<String>, String> {
    use std::fs;

    let path = PathBuf::from(&folder_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Invalid directory: {}", folder_path));
    }

    let image_extensions = vec!["png", "jpg", "jpeg", "webp", "gif", "bmp"];
    let mut image_paths = Vec::new();

    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_file() {
            if let Some(ext) = path.extension() {
                if let Some(ext_str) = ext.to_str() {
                    if image_extensions.contains(&ext_str.to_lowercase().as_str()) {
                        if let Some(path_str) = path.to_str() {
                            image_paths.push(path_str.to_string());
                        }
                    }
                }
            }
        }
    }

    Ok(image_paths)
}

fn compute_iou(a: &BboxCoordinates, b: &BboxCoordinates) -> f64 {
    let x1 = a.x.max(b.x);
    let y1 = a.y.max(b.y);
    let x2 = (a.x + a.width).min(b.x + b.width);
    let y2 = (a.y + a.height).min(b.y + b.height);

    let intersection = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    let area_a = a.width * a.height;
    let area_b = b.width * b.height;
    let union = area_a + area_b - intersection;

    if union > 0.0 { intersection / union } else { 0.0 }
}
