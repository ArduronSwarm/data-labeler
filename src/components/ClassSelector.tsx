import React, { useState } from 'react';

export interface ClassDefinition {
  id: number;
  name: string;
  color: string;
}

interface ClassSelectorProps {
  classes: ClassDefinition[];
  selectedClassId: number | null;
  onClassSelect: (classId: number) => void;
  onClassesChange: (classes: ClassDefinition[]) => void;
}

export const ClassSelector: React.FC<ClassSelectorProps> = ({
  classes,
  selectedClassId,
  onClassSelect,
  onClassesChange,
}) => {
  const [showAddClass, setShowAddClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassColor, setNewClassColor] = useState('#00ff00');

  const handleAddClass = () => {
    if (!newClassName.trim()) return;
    
    const newClass: ClassDefinition = {
      id: classes.length > 0 ? Math.max(...classes.map(c => c.id)) + 1 : 0,
      name: newClassName.trim(),
      color: newClassColor,
    };
    
    onClassesChange([...classes, newClass]);
    setNewClassName('');
    setNewClassColor('#00ff00');
    setShowAddClass(false);
  };

  const handleDeleteClass = (classId: number) => {
    const remainingClasses = classes.filter(c => c.id !== classId);
    onClassesChange(remainingClasses);

    // If deleting the selected class, select the first remaining class (or null if none)
    if (selectedClassId === classId) {
      const nextClass = remainingClasses[0];
      onClassSelect(nextClass ? nextClass.id : null as any);
    }
  };

  return (
    <div className="flex items-center space-x-2">
      <span className="text-neutral-400 text-sm">Class:</span>

      {/* No Classes Message */}
      {classes.length === 0 && (
        <span className="text-yellow-400 text-sm italic">No classes yet - add one to start labeling</span>
      )}

      {/* Class Buttons */}
      {classes.map((cls) => (
        <button
          key={cls.id}
          onClick={() => onClassSelect(cls.id)}
          className={`px-3 py-1.5 rounded text-sm transition-all ${
            selectedClassId === cls.id
              ? 'ring-2 ring-white'
              : 'hover:opacity-80'
          }`}
          style={{
            backgroundColor: cls.color,
            color: '#000',
          }}
        >
          {cls.name}
        </button>
      ))}

      {/* Add Class Button */}
      {!showAddClass ? (
        <button
          onClick={() => setShowAddClass(true)}
          className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-white rounded text-sm transition-colors"
        >
          + Add Class
        </button>
      ) : (
        <div className="flex items-center space-x-2 bg-neutral-800 p-2 rounded">
          <input
            type="text"
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            placeholder="Class name"
            className="px-2 py-1 bg-neutral-900 text-white rounded text-sm w-32"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddClass();
              if (e.key === 'Escape') setShowAddClass(false);
            }}
          />
          <input
            type="color"
            value={newClassColor}
            onChange={(e) => setNewClassColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer"
          />
          <button
            onClick={handleAddClass}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
          >
            ✓
          </button>
          <button
            onClick={() => setShowAddClass(false)}
            className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 text-white rounded text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {/* Delete Class Button (only show when class is selected) */}
      {selectedClassId !== null && (
        <button
          onClick={() => {
            if (window.confirm(`Delete class "${classes.find(c => c.id === selectedClassId)?.name}"? All annotations using this class will be removed.`)) {
              handleDeleteClass(selectedClassId);
            }
          }}
          className="px-2 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition-colors"
          title="Delete selected class and all its annotations"
        >
          Delete Class
        </button>
      )}
    </div>
  );
};
