import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";
import { downloadDir, join } from "@tauri-apps/api/path";
import "./App.css";

interface CompressionStats {
  original: number;
  compressed: number;
  format: string;
}

function App() {
  const [isDragging, setIsDragging] = useState(false);
  const [compressedFile, setCompressedFile] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionStats, setCompressionStats] = useState<CompressionStats | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    setIsCompressing(true);
    setFileName(file.name.replace(/\.[^.]+$/, ""));
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        const result = await invoke("compress_image", { 
          imageData: base64,
          fileName: file.name
        }) as { compressed_data: string; original_size: number; compressed_size: number; format: string };
        
        setCompressedFile(result.compressed_data);
        setCompressionStats({
          original: result.original_size,
          compressed: result.compressed_size,
          format: result.format
        });
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error compressing image:', error);
      alert('Error compressing image');
    } finally {
      setIsCompressing(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    await processFile(files[0]);
  }, [processFile]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    await processFile(files[0]);
  }, [processFile]);

  const handleDownload = useCallback(async () => {
    if (!compressedFile || !compressionStats) return;
    
    const fileExt = compressionStats.format.toLowerCase();
    const fileBase = fileName || "compressed-image";
    const fileFullName = `${fileBase}-compressed.${fileExt}`;
    
    try {
      // Get Downloads directory
      const downloads = await downloadDir();
      const filePath = await join(downloads, fileFullName);
      
      // Convert base64 to Uint8Array
      const binary = Uint8Array.from(atob(compressedFile), c => c.charCodeAt(0));
      
      // Write file using Tauri's fs API
      await writeFile(filePath, binary);
      alert(`Saved to Downloads: ${fileFullName}`);
    } catch (e) {
      console.error('Error saving file:', e);
      // Fallback to browser download
      const link = document.createElement('a');
      link.href = compressedFile;
      link.download = fileFullName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [compressedFile, compressionStats, fileName]);

  const handleDropZoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const calculateSavings = (original: number, compressed: number) => {
    const savings = ((original - compressed) / original) * 100;
    return savings.toFixed(1);
  };

  return (
    <main className="container">
      <h1>Image Compressor</h1>
      
      <div 
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleDropZoneClick}
      >
        <input
          type="file"
          ref={fileInputRef}
          className="file-input"
          accept="image/*"
          onChange={handleFileSelect}
        />
        {isCompressing ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Compressing your image...</p>
          </div>
        ) : (
          <>
            <div className="icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM5 5h14v14H5V5z" fill="currentColor"/>
              </svg>
            </div>
            <p>Drag and drop an image here</p>
            <p className="subtitle">or click to select a file</p>
          </>
        )}
      </div>

      {compressedFile && compressionStats && (
        <div className="result">
          <h2>Compression Complete!</h2>
          <div className="compression-stats">
            <div className="stat-item">
              <span className="stat-label">Original size</span>
              <span className="stat-value">{formatFileSize(compressionStats.original)}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Compressed size</span>
              <span className="stat-value">{formatFileSize(compressionStats.compressed)}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Space saved</span>
              <span className={`stat-value ${compressionStats.compressed < compressionStats.original ? 'positive' : 'negative'}`}>
                {calculateSavings(compressionStats.original, compressionStats.compressed)}%
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Format</span>
              <span className="stat-value format">{compressionStats.format.toUpperCase()}</span>
            </div>
          </div>
          <button className="button" onClick={handleDownload}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/>
            </svg>
            Download Compressed Image
          </button>
        </div>
      )}
    </main>
  );
}

export default App;
