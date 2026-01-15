import React, { useMemo } from 'react';
import { Layer, Image as KonvaImage } from 'react-konva';
import useImage from 'use-image';
import { convertFileSrc } from '@tauri-apps/api/core';

interface BackgroundLayerProps {
    imageSrc: string | null;
    onImageLoad?: (width: number, height: number) => void;
}

export const BackgroundLayer: React.FC<BackgroundLayerProps> = ({ imageSrc, onImageLoad }) => {
    // Convert file path to Tauri asset URL
    const assetUrl = useMemo(() => {
        if (!imageSrc) return '';
        // If it's already a URL (http/https), use it directly
        if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
            return imageSrc;
        }
        // Otherwise, convert file path to Tauri asset URL
        const converted = convertFileSrc(imageSrc);
        console.log('Original path:', imageSrc);
        console.log('Converted URL:', converted);
        return converted;
    }, [imageSrc]);

    const [image, status] = useImage(assetUrl);

    console.log('Image loading status:', status, 'Image:', image ? 'loaded' : 'not loaded');

    // Notify parent when image loads with dimensions
    React.useEffect(() => {
        if (image && onImageLoad) {
            onImageLoad(image.width, image.height);
        }
    }, [image, onImageLoad]);

    if (!imageSrc || !image) {
        return null;
    }

    return (
        <Layer listening={false}>
            <KonvaImage image={image} listening={false} />
        </Layer>
    );
};
