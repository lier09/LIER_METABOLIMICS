
import { TableData, TableRow } from '../types';

declare const XLSX: any;

export const parseFile = (file: File): Promise<TableData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData: TableRow[] = XLSX.utils.sheet_to_json(worksheet, { defval: null });

        if (jsonData.length === 0) {
          reject(new Error("文件为空或格式不正确。"));
          return;
        }

        const headers = Object.keys(jsonData[0]);
        resolve({ headers, rows: jsonData });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsBinaryString(file);
  });
};


export const exportFile = (tableData: TableData, fileName: string) => {
  try {
    const dataToExport = [tableData.headers, ...tableData.rows.map(row => tableData.headers.map(header => row[header]))];
    const worksheet = XLSX.utils.aoa_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, `${fileName}.xlsx`);
  } catch (error) {
    console.error("导出文件失败:", error);
    alert("导出文件失败。请检查控制台获取更多信息。");
  }
};
