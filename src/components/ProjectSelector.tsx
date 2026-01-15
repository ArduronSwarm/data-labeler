import { useState, useEffect } from 'react';
import { db, Project } from '../lib/tauri-commands';
import { Trash2 } from 'lucide-react';

interface ProjectSelectorProps {
  onSelectProject: (id: number) => void;
  onCreateProject: (name: string) => void;
}

export const ProjectSelector: React.FC<ProjectSelectorProps> = ({ onSelectProject, onCreateProject }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const allProjects = await db.getAllProjects();
        setProjects(allProjects);
      } catch (err) {
        console.error("Failed to load projects:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadProjects();
  }, []);

  const handleCreateProject = () => {
    if (!newProjectName.trim()) {
      alert("Please enter a project name");
      return;
    }
    onCreateProject(newProjectName.trim());
    setShowCreateDialog(false);
    setNewProjectName('');
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;

    try {
      await db.deleteProject(projectToDelete.id);
      // Refresh project list
      const updatedProjects = await db.getAllProjects();
      setProjects(updatedProjects);
      setProjectToDelete(null);
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-neutral-900 text-white flex items-center justify-center">
        Loading projects...
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-neutral-900 text-white flex items-center justify-center">
      <div className="max-w-2xl w-full mx-4">
        <div className="bg-neutral-800 rounded-lg shadow-xl p-8">
          <h1 className="text-3xl font-bold mb-2 text-center">Arduron Data Labeling</h1>
          <p className="text-neutral-400 text-center mb-8">Select a project or create a new one</p>

          {/* Project List */}
          <div className="mb-6">
            {projects.length === 0 ? (
              <div className="text-center py-8 text-neutral-500">
                No projects found. Create your first project to get started.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {projects.map(project => (
                  <div
                    key={project.id}
                    className="relative w-full p-4 bg-neutral-700 hover:bg-neutral-600 rounded transition-colors group"
                  >
                    <button
                      onClick={() => onSelectProject(project.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between pr-10">
                        <div>
                          <h3 className="font-semibold text-lg group-hover:text-blue-400 transition-colors">
                            {project.name}
                          </h3>
                          <p className="text-sm text-neutral-400">
                            Created: {new Date(project.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <svg
                          className="w-6 h-6 text-neutral-500 group-hover:text-blue-400 transition-colors"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectToDelete(project);
                      }}
                      className="absolute top-4 right-4 p-2 text-neutral-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                      aria-label="Delete project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create New Project Button */}
          <button
            onClick={() => setShowCreateDialog(true)}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold transition-colors"
          >
            + Create New Project
          </button>
        </div>
      </div>

      {/* Create Project Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-neutral-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-xl font-bold mb-4">Create New Project</h2>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              placeholder="Project name"
              className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded text-white placeholder-neutral-400 focus:outline-none focus:border-blue-500 mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowCreateDialog(false);
                  setNewProjectName('');
                }}
                className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProject}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {projectToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-2">Delete Project</h3>
            <p className="text-neutral-300 mb-4">
              Are you sure you want to delete <span className="font-semibold text-white">{projectToDelete.name}</span>?
            </p>
            <p className="text-red-400 text-sm mb-6">
              This will permanently delete all images and annotations associated with this project. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setProjectToDelete(null)}
                className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProject}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded transition-colors"
              >
                Delete Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
