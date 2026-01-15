use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use image::GenericImageView;

#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub ontology: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Image {
    pub id: i64,
    pub project_id: i64,
    pub file_path: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub status: String,
    pub split_set: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Annotation {
    pub id: Option<i64>,
    pub image_id: i64,
    pub label_id: i64,
    pub geometry_type: String,
    pub coordinates: String,
    pub source: String,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                ontology TEXT DEFAULT '{}',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                file_path TEXT NOT NULL,
                width INTEGER,
                height INTEGER,
                status TEXT DEFAULT 'UNLABELED',
                split_set TEXT,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            CREATE TABLE IF NOT EXISTS annotations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                image_id INTEGER,
                label_id INTEGER,
                geometry_type TEXT,
                coordinates TEXT,
                source TEXT DEFAULT 'manual',
                FOREIGN KEY(image_id) REFERENCES images(id)
            );"
        )?;
        
        Ok(Database { conn })
    }

    pub fn get_project(&self, id: i64) -> Result<Option<Project>> {
        let mut stmt = self.conn.prepare("SELECT * FROM projects WHERE id = ?")?;
        let mut rows = stmt.query(params![id])?;
        
        if let Some(row) = rows.next()? {
            Ok(Some(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                ontology: row.get(2)?,
                created_at: row.get(3)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_all_projects(&self) -> Result<Vec<Project>> {
        let mut stmt = self.conn.prepare("SELECT * FROM projects ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                ontology: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;

        let mut projects = Vec::new();
        for project in rows {
            projects.push(project?);
        }
        Ok(projects)
    }

    pub fn create_project(&self, name: String, ontology: String) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO projects (name, ontology) VALUES (?, ?)",
            params![name, ontology],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_project(&self, id: i64, name: String, ontology: String) -> Result<()> {
        self.conn.execute(
            "UPDATE projects SET name = ?, ontology = ? WHERE id = ?",
            params![name, ontology, id],
        )?;
        Ok(())
    }

    pub fn get_images(&self, project_id: i64) -> Result<Vec<Image>> {
        let mut stmt = self.conn.prepare("SELECT * FROM images WHERE project_id = ?")?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(Image {
                id: row.get(0)?,
                project_id: row.get(1)?,
                file_path: row.get(2)?,
                width: row.get(3)?,
                height: row.get(4)?,
                status: row.get(5)?,
                split_set: row.get(6)?,
            })
        })?;

        let mut images = Vec::new();
        for image in rows {
            images.push(image?);
        }
        Ok(images)
    }

    fn get_image_dimensions(file_path: &str) -> (Option<i64>, Option<i64>) {
        match image::open(file_path) {
            Ok(img) => {
                let (width, height) = img.dimensions();
                (Some(width as i64), Some(height as i64))
            }
            Err(_) => (None, None)
        }
    }

    pub fn add_image(&self, project_id: i64, file_path: String) -> Result<i64> {
        let (width, height) = Self::get_image_dimensions(&file_path);
        self.conn.execute(
            "INSERT INTO images (project_id, file_path, width, height) VALUES (?, ?, ?, ?)",
            params![project_id, file_path, width, height],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn add_images(&self, project_id: i64, file_paths: Vec<String>) -> Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        for file_path in &file_paths {
            let (width, height) = Self::get_image_dimensions(file_path);
            tx.execute(
                "INSERT INTO images (project_id, file_path, width, height) VALUES (?, ?, ?, ?)",
                params![project_id, file_path, width, height],
            )?;
        }
        tx.commit()?;
        Ok(file_paths.len())
    }

    pub fn get_annotations(&self, image_id: i64) -> Result<Vec<Annotation>> {
        let mut stmt = self.conn.prepare("SELECT * FROM annotations WHERE image_id = ?")?;
        let rows = stmt.query_map(params![image_id], |row| {
            Ok(Annotation {
                id: Some(row.get(0)?),
                image_id: row.get(1)?,
                label_id: row.get(2)?,
                geometry_type: row.get(3)?,
                coordinates: row.get(4)?,
                source: row.get(5)?,
            })
        })?;

        let mut annotations = Vec::new();
        for annotation in rows {
            annotations.push(annotation?);
        }
        Ok(annotations)
    }

    pub fn save_annotation(&self, annotation: Annotation) -> Result<i64> {
        if let Some(id) = annotation.id {
            self.conn.execute(
                "UPDATE annotations SET coordinates = ?, label_id = ?, geometry_type = ? WHERE id = ?",
                params![annotation.coordinates, annotation.label_id, annotation.geometry_type, id],
            )?;
            Ok(id)
        } else {
            self.conn.execute(
                "INSERT INTO annotations (image_id, label_id, geometry_type, coordinates, source) VALUES (?, ?, ?, ?, ?)",
                params![
                    annotation.image_id,
                    annotation.label_id,
                    annotation.geometry_type,
                    annotation.coordinates,
                    annotation.source
                ],
            )?;
            Ok(self.conn.last_insert_rowid())
        }
    }

    pub fn delete_annotation(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM annotations WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn delete_project(&self, id: i64) -> Result<()> {
        // Get all images for this project
        let images = self.get_images(id)?;

        // Delete all annotations for each image
        for image in images {
            self.conn.execute(
                "DELETE FROM annotations WHERE image_id = ?",
                params![image.id]
            )?;
        }

        // Delete all images for this project
        self.conn.execute(
            "DELETE FROM images WHERE project_id = ?",
            params![id]
        )?;

        // Finally delete the project
        self.conn.execute(
            "DELETE FROM projects WHERE id = ?",
            params![id]
        )?;

        Ok(())
    }

    pub fn update_image_status(&self, image_id: i64, status: String) -> Result<()> {
        self.conn.execute(
            "UPDATE images SET status = ? WHERE id = ?",
            params![status, image_id],
        )?;
        Ok(())
    }

    pub fn auto_split_dataset(&self, project_id: i64, train_ratio: f64, val_ratio: f64) -> Result<(i64, i64, i64)> {
        use std::collections::HashMap;
        
        let images = self.get_images(project_id)?;
        let total = images.len();
        
        if total == 0 {
            return Ok((0, 0, 0));
        }
        
        // Group images by filename prefix (for video frame sequences)
        // e.g., "video_01_frame_001.jpg" -> "video_01"
        let mut groups: HashMap<String, Vec<i64>> = HashMap::new();
        
        for img in &images {
            let path = std::path::Path::new(&img.file_path);
            let filename = path.file_stem().unwrap_or_default().to_string_lossy();
            
            // Extract prefix: split by underscore and take first 2 parts if numeric suffix exists
            let parts: Vec<&str> = filename.split('_').collect();
            let prefix = if parts.len() >= 2 {
                // Check if last part looks like a frame number
                let last = parts.last().unwrap_or(&"");
                if last.chars().all(|c| c.is_numeric()) {
                    parts[..parts.len()-1].join("_")
                } else {
                    filename.to_string()
                }
            } else {
                filename.to_string()
            };
            
            groups.entry(prefix).or_default().push(img.id);
        }
        
        // Shuffle groups for randomization
        let mut group_keys: Vec<String> = groups.keys().cloned().collect();
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        // Simple deterministic shuffle based on project_id
        let mut hasher = DefaultHasher::new();
        project_id.hash(&mut hasher);
        let seed = hasher.finish();
        
        group_keys.sort_by(|a, b| {
            let mut h1 = DefaultHasher::new();
            let mut h2 = DefaultHasher::new();
            (a, seed).hash(&mut h1);
            (b, seed).hash(&mut h2);
            h1.finish().cmp(&h2.finish())
        });
        
        // Assign groups to splits
        let train_target = (total as f64 * train_ratio).floor() as usize;
        let val_target = (total as f64 * val_ratio).floor() as usize;
        
        let mut train_ids: Vec<i64> = Vec::new();
        let mut val_ids: Vec<i64> = Vec::new();
        let mut test_ids: Vec<i64> = Vec::new();
        
        for key in group_keys {
            let ids = groups.get(&key).unwrap();
            
            if train_ids.len() < train_target {
                train_ids.extend(ids);
            } else if val_ids.len() < val_target {
                val_ids.extend(ids);
            } else {
                test_ids.extend(ids);
            }
        }
        
        // Update database
        let tx = self.conn.unchecked_transaction()?;
        
        for id in &train_ids {
            tx.execute("UPDATE images SET split_set = 'train' WHERE id = ?", params![id])?;
        }
        for id in &val_ids {
            tx.execute("UPDATE images SET split_set = 'val' WHERE id = ?", params![id])?;
        }
        for id in &test_ids {
            tx.execute("UPDATE images SET split_set = 'test' WHERE id = ?", params![id])?;
        }
        
        tx.commit()?;
        
        Ok((train_ids.len() as i64, val_ids.len() as i64, test_ids.len() as i64))
    }
}
