
import React, { useState, useCallback, useRef } from 'react';
import { UploadIcon } from './icons';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  disabled: boolean;
  title: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, disabled, title }) => {
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFileName(file.name);
      onFileSelect(file);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      onClick={!disabled ? handleClick : undefined}
      className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-md transition-colors
        ${disabled
          ? 'border-slate-200 bg-slate-100 text-slate-400'
          : 'border-slate-300 hover:border-sky-500 cursor-pointer bg-white'
        }`}
    >
      <div className="space-y-1 text-center">
        <UploadIcon className={`mx-auto h-12 w-12 ${disabled ? 'text-slate-400' : 'text-slate-400'}`} />
        <div className="flex text-sm text-slate-600">
          <p className="pl-1">{title}</p>
          <input ref={fileInputRef} id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} disabled={disabled} accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" />
        </div>
        <p className="text-xs text-slate-500">支持 CSV, XLSX 文件</p>
        {fileName && <p className="text-sm text-sky-500 pt-2">{fileName}</p>}
      </div>
    </div>
  );
};