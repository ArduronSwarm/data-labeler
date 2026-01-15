import React, { useRef, useEffect } from 'react';
import { Layer, Rect, Transformer } from 'react-konva';
import Konva from 'konva';

interface ActiveLayerProps {
    annotations: any[];
    newAnnotation: any | null;
    scale: number;
    selectedColor: string;
    selectedAnnotationId: string | null;
    onAnnotationChange?: (id: string, changes: { x: number; y: number; width: number; height: number }) => void;
    onAnnotationSelect?: (id: string) => void;
}

export const ActiveLayer: React.FC<ActiveLayerProps> = ({
    annotations,
    newAnnotation,
    scale,
    selectedColor,
    selectedAnnotationId,
    onAnnotationChange,
    onAnnotationSelect
}) => {
    const transformerRef = useRef<Konva.Transformer>(null);
    const selectedRectRef = useRef<Konva.Rect>(null);

    useEffect(() => {
        if (transformerRef.current && selectedRectRef.current) {
            transformerRef.current.nodes([selectedRectRef.current]);
            transformerRef.current.getLayer()?.batchDraw();
        }
    }, [selectedAnnotationId]);

    return (
        <Layer>
            {annotations.map((rect, index) => {
                const rectId = rect.id?.toString() || rect.tempId || `ann_${index}`;
                const isSelected = rectId === selectedAnnotationId;

                return (
                    <Rect
                        key={rectId}
                        ref={isSelected ? selectedRectRef : null}
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                        stroke={rect.color || '#00ff00'}
                        strokeWidth={isSelected ? 3 / scale : 2 / scale}
                        dash={isSelected ? [10 / scale, 5 / scale] : undefined}
                        draggable={isSelected}
                        listening={true}
                        hitStrokeWidth={isSelected ? 10 / scale : 5 / scale}
                        onClick={(e) => {
                            e.cancelBubble = true;
                            onAnnotationSelect?.(rectId);
                        }}
                        onDragStart={(e) => {
                            // Prevent stage from being dragged when dragging annotation
                            e.cancelBubble = true;
                        }}
                        onDragEnd={(e) => {
                            if (onAnnotationChange) {
                                const node = e.target;
                                onAnnotationChange(rectId, {
                                    x: node.x(),
                                    y: node.y(),
                                    width: node.width() * node.scaleX(),
                                    height: node.height() * node.scaleY()
                                });
                            }
                        }}
                        onTransformEnd={(e) => {
                            if (onAnnotationChange) {
                                const node = e.target;
                                // Reset scale to 1 and adjust width/height
                                const scaleX = node.scaleX();
                                const scaleY = node.scaleY();

                                onAnnotationChange(rectId, {
                                    x: node.x(),
                                    y: node.y(),
                                    width: node.width() * scaleX,
                                    height: node.height() * scaleY
                                });

                                // Reset scale
                                node.scaleX(1);
                                node.scaleY(1);
                            }
                        }}
                    />
                );
            })}
            {newAnnotation && (
                <Rect
                    x={newAnnotation.x}
                    y={newAnnotation.y}
                    width={newAnnotation.width}
                    height={newAnnotation.height}
                    stroke={selectedColor}
                    strokeWidth={2 / scale}
                    dash={[5 / scale, 5 / scale]}
                />
            )}
            {selectedAnnotationId && (
                <Transformer
                    ref={transformerRef}
                    rotateEnabled={false}
                    borderStroke="#00ff00"
                    borderStrokeWidth={2 / scale}
                    anchorStroke="#00ff00"
                    anchorFill="#ffffff"
                    anchorSize={10 / scale}
                    anchorCornerRadius={2 / scale}
                    keepRatio={false}
                    enabledAnchors={[
                        'top-left',
                        'top-right',
                        'bottom-left',
                        'bottom-right',
                        'top-center',
                        'middle-left',
                        'middle-right',
                        'bottom-center'
                    ]}
                    boundBoxFunc={(oldBox, newBox) => {
                        // Prevent the box from becoming too small
                        if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
                            return oldBox;
                        }
                        return newBox;
                    }}
                />
            )}
        </Layer>
    );
};
