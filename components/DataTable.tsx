
import React from 'react';
import { TableData } from '../types';

interface DataTableProps {
  data: TableData | null;
}

const getStatusColor = (status: string): string => {
    if (status === '保留') return 'text-green-600 font-semibold';
    if (status === '删除') return 'text-red-600';
    if (status.includes('剔除')) return 'text-amber-600';
    return 'text-slate-600';
};

export const DataTable: React.FC<DataTableProps> = ({ data }) => {
  if (!data || data.rows.length === 0) {
    return (
        <div className="mt-4 p-4 text-center text-slate-500 border border-dashed border-slate-300 rounded-md bg-white">
            暂无数据显示。请先上传文件。
        </div>
    );
  }

  const previewRows = data.rows.slice(0, 20);
  const hasStatusColumn = data.rows[0] && '_derep_status' in data.rows[0];

  return (
    <div className="mt-4 flow-root">
      <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
        <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
          <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-100">
                <tr>
                  {data.headers.map((header) => (
                    <th key={header} scope="col" className="py-3.5 px-3 text-left text-sm font-semibold text-slate-700">
                      {header}
                    </th>
                  ))}
                  {hasStatusColumn && (
                    <th scope="col" className="py-3.5 px-3 text-left text-sm font-semibold text-slate-700">
                        去重状态
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {previewRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-slate-50">
                    {data.headers.map((header) => (
                      <td key={`${rowIndex}-${header}`} className="whitespace-nowrap py-4 px-3 text-sm text-slate-600">
                        {String(row[header] ?? '')}
                      </td>
                    ))}
                    {hasStatusColumn && (
                        <td className={`whitespace-nowrap py-4 px-3 text-sm ${getStatusColor(row._derep_status as string)}`}>
                            {String(row._derep_status ?? '')}
                        </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.rows.length > 20 && (
            <p className="text-center text-sm text-slate-500 mt-2">
              仅显示前20行。完整数据将在下载的文件中提供。
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
