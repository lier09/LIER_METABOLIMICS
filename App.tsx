
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { Stepper } from './components/Stepper';
import { FileUpload } from './components/FileUpload';
import { DataTable } from './components/DataTable';
import { Modal } from './components/Modal';
import { ConfirmationModal } from './components/ConfirmationModal';
import { DownloadIcon, WarningIcon, DatabaseIcon, NetworkIcon, SparklesIcon, PlusCircleIcon, CheckBadgeIcon, FilterIcon, CheckIcon, CloseIcon, DocumentDuplicateIcon, MagnifyingGlassIcon, ChatBubbleLeftRightIcon } from './components/icons';
import { parseFile, exportFile } from './services/fileProcessor';
import type { TableData, TableRow, ProcessingStep, IdentificationResult } from './types';

const PROCESSING_STEPS: ProcessingStep[] = [
  { name: 'Mzmine导出数据增列', description: '上传 Mzmine 导出文件或已处理的净表。', fileType: 'mzmine', requiredColumns: [], matchColumn: '', appendColumns: [] },
  { name: '上传净表', description: '确认基础数据已加载并符合要求。', fileType: 'netTable', requiredColumns: ['ID', 'MZ'], matchColumn: '', appendColumns: [] },
  { name: '匹配FBMN', description: '上传FBMN特征文件以匹配ID并追加信息。', fileType: 'fbmn', requiredColumns: ['ID'], matchColumn: 'ID', appendColumns: ['Compound_Name', 'NAME (中文翻译)', 'Adduct', 'LibraryQualityString', 'MQScore', 'MZErrorPPM', 'SharedPeaks'] },
  { name: '匹配Sirius', description: '上传Sirius匹配结果以匹配ID并追加信息。', fileType: 'sirius', requiredColumns: ['ID'], matchColumn: 'ID', appendColumns: ['name', 'molecularFormula', 'ConfidenceScoreExact', 'smiles', 'ConfidenceScoreApproximate', 'InChIkey2D'] },
  { name: '匹配补充列', description: '上传补充列文件以匹配MZ并追加信息。', fileType: 'supplementary', requiredColumns: ['ionMass'], matchColumn: 'ionMass', matchColumnBase: 'MZ', appendColumns: ['molecularFormula', 'NPC#superclass', 'ClassyFire#superclass', 'ClassyFire#class', 'InChI'] },
  { name: '生成最终注释', description: '基于FBMN和Sirius的结果生成最终注释列。', fileType: 'annotation', requiredColumns: [], matchColumn: '', appendColumns: ['Final_Annotation'] },
];

const stepIcons = [
    (props: any) => <DatabaseIcon {...props} />,
    (props: any) => <CheckIcon {...props} />,
    (props: any) => <NetworkIcon {...props} />,
    (props: any) => <SparklesIcon {...props} />,
    (props: any) => <PlusCircleIcon {...props} />,
    (props: any) => <CheckBadgeIcon {...props} />,
];

const determineFinalAnnotation = (row: TableRow): string => {
    const compoundName = String(row['Compound_Name'] || '').trim();
    const siriusName = String(row['name'] || '').trim();

    if (!compoundName && !siriusName) return '';
    if (compoundName && !siriusName) return compoundName;
    if (!compoundName && siriusName) return siriusName;

    if (compoundName.toLowerCase() === siriusName.toLowerCase()) {
      return compoundName;
    }

    const mqScore = parseFloat(String(row['MQScore']));
    const libQuality = String(row['LibraryQualityString'] || '');
    const sharedPeaks = parseInt(String(row['SharedPeaks']));
    const mzError = parseFloat(String(row['MZErrorPPM']));
    const confidence = parseFloat(String(row['ConfidenceScoreExact']));

    const isFbmnStrong = !isNaN(mqScore) && !isNaN(sharedPeaks) && !isNaN(mzError) &&
                         mqScore > 0.9 &&
                         libQuality === 'Gold' &&
                         sharedPeaks > 10 &&
                         Math.abs(mzError) < 5;

    const isSiriusStrong = !isNaN(confidence) && confidence > 0.8;
    
    if (isFbmnStrong && isSiriusStrong) {
        return siriusName;
    }
    if (isFbmnStrong) {
        return compoundName;
    }
    if (isSiriusStrong) {
        return siriusName;
    }
    return compoundName;
};

const Toast = ({ message, onClose }: { message: string, onClose: () => void }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className="fixed top-5 right-5 bg-green-500 text-white py-2 px-4 rounded-lg shadow-lg flex items-center animate-fade-in-down z-50">
            <CheckIcon className="w-5 h-5 mr-2" />
            <span>{message}</span>
        </div>
    );
};


const App: React.FC = () => {
  // Workflow state
  const [currentStep, setCurrentStep] = useState(0);
  const [netTable, setNetTable] = useState<TableData | null>(null);
  const [mergedData, setMergedData] = useState<TableData | null>(null);
  const [dataHistory, setDataHistory] = useState<(TableData)[]>([]);
  const [allUnmatched, setAllUnmatched] = useState<Record<number, (string | number)[]>>({});

  // Dereplication tool state
  const [dereplicationData, setDereplicationData] = useState<TableData | null>(null);
  const [dataBeforeDereplication, setDataBeforeDereplication] = useState<TableData | null>(null);
  const [isDereplicated, setIsDereplicated] = useState(false);

  // Filter tool state
  const [filterToolData, setFilterToolData] = useState<TableData | null>(null);
  const [dataBeforeFilter, setDataBeforeFilter] = useState<TableData | null>(null);
  const [contaminantList, setContaminantList] = useState<Set<string> | null>(null);
  const [contaminantText, setContaminantText] = useState('');
  const [isFiltered, setIsFiltered] = useState(false);
  
  // Identification tool state
  const [identificationSource, setIdentificationSource] = useState<'gemini' | 'api'>('gemini');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [msmsData, setMsmsData] = useState('');
  const [precursorMz, setPrecursorMz] = useState('');
  const [identificationResult, setIdentificationResult] = useState<IdentificationResult | null>(null);
  const [apiResult, setApiResult] = useState<string | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(false);
  
  // Explanation tool state
  const [explanationMetabolites, setExplanationMetabolites] = useState('');
  const [isExplaining, setIsExplaining] = useState(false);

  // Global state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [unmatchedItems, setUnmatchedItems] = useState<(string | number)[]>([]);
  const [modalTitle, setModalTitle] = useState('');
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const filterToolRef = useRef<HTMLDivElement | null>(null);
  const dereplicationToolRef = useRef<HTMLDivElement | null>(null);
  const identificationToolRef = useRef<HTMLDivElement | null>(null);
  const explanationToolRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (currentStep < PROCESSING_STEPS.length && stepRefs.current[currentStep]) {
      setTimeout(() => {
          stepRefs.current[currentStep]?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
      }, 100);
    }
  }, [currentStep]);

  const showToast = (message: string) => {
    setToastMessage(message);
  };

  const handleReset = () => {
    setCurrentStep(0);
    setNetTable(null);
    setMergedData(null);
    setDataHistory([]);
    setAllUnmatched({});
    setFilterToolData(null);
    setDataBeforeFilter(null);
    setContaminantList(null);
    setContaminantText('');
    setIsFiltered(false);
    setDereplicationData(null);
    setDataBeforeDereplication(null);
    setIsDereplicated(false);
    setMsmsData('');
    setPrecursorMz('');
    setIdentificationResult(null);
    setApiResult(null);
    setIdentificationSource('gemini');
    setApiUrl('');
    setApiKey('');
    setIsIdentifying(false);
    setExplanationMetabolites('');
    setIsExplaining(false);
    setIsLoading(false);
    setError(null);
    setModalOpen(false);
    setUnmatchedItems([]);
    setModalTitle('');
    setResetModalOpen(false);
    showToast('已重置所有步骤');
  };

  const handleFileProcess = useCallback(async (file: File) => {
    const stepConfig = PROCESSING_STEPS[currentStep];
    if (!stepConfig) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await parseFile(file);
      
      if (currentStep === 0) { // New Mzmine parsing step
        const { headers, rows } = data;
        let processedData: TableData;

        if (headers.includes('ID') && headers.includes('MZ') && headers.includes('RT')) {
            showToast('文件已包含所需列。');
            processedData = data;
        } else if (headers.includes('Filename')) {
            const newRows = rows.map(row => {
                const filename = String(row['Filename'] || '');
                const parts = filename.split('/');
                if (parts.length >= 3) {
                    const id = parts[0].trim();
                    const mz = parts[1].replace(/mz/i, '').trim();
                    const rt = parts[2].replace(/min/i, '').trim();
                    return { ...row, ID: id, MZ: mz, RT: rt };
                }
                return { ...row, ID: null, MZ: null, RT: null };
            });

            const originalHeaders = [...headers];
            const newHeaders = ['ID', 'MZ', 'RT'].filter(h => !originalHeaders.includes(h));
            const filenameIndex = originalHeaders.indexOf('Filename');
            if (filenameIndex !== -1) {
                originalHeaders.splice(filenameIndex + 1, 0, ...newHeaders);
            } else {
                originalHeaders.unshift(...newHeaders);
            }
            
            const finalHeaders = [...new Set(originalHeaders)];
            processedData = { headers: finalHeaders, rows: newRows };
            showToast('成功从 Filename 列生成 ID, MZ, RT。');
        } else {
            throw new Error(`文件必须包含 'ID', 'MZ', 'RT' 列，或者包含 'Filename' 列以供解析。`);
        }
        
        const finalCheckCols = ['ID', 'MZ'];
        const missingColsCheck = finalCheckCols.filter(col => !processedData.headers.includes(col));
        if (missingColsCheck.length > 0) {
            throw new Error(`处理后，文件仍缺少必需的列: ${missingColsCheck.join(', ')}`);
        }
        
        setNetTable(processedData);
        setMergedData(processedData);
        setDataHistory([processedData]);
        setCurrentStep(1);

      } else { // Handle matching steps (2, 3, 4)
        if (!mergedData || !netTable) {
          throw new Error('基础数据丢失，请重新开始。');
        }

        const missingCols = stepConfig.requiredColumns.filter(col => !data.headers.includes(col));
        if (missingCols.length > 0) {
          throw new Error(`文件缺少必需的列: ${missingCols.join(', ')}`);
        }

        let newMergedRows: TableRow[] = [];
        let newHeaders = [...mergedData.headers];
        let foundUnmatched: (string | number)[] = [];
        
        const appendCols = stepConfig.appendColumns.filter(col => !newHeaders.includes(col));
        newHeaders.push(...appendCols);

        if (stepConfig.matchColumn === 'ID') {
           const matchMap = new Map(
             data.rows
              .filter(row => row.ID != null && String(row.ID).trim() !== '')
              .map(row => [String(row.ID).trim(), row])
           );

           newMergedRows = mergedData.rows.map((baseRow) => {
               const baseId = baseRow.ID;
               if (baseId == null || String(baseId).trim() === '') {
                   return baseRow;
               }

               const match = matchMap.get(String(baseId).trim());
               if (match) {
                   const newRowData: TableRow = {};
                   stepConfig.appendColumns.forEach(col => newRowData[col] = match[col] ?? null);
                   return { ...baseRow, ...newRowData };
               }
               return baseRow;
           });

            const baseIdSet = new Set(netTable.rows.map(row => String(row.ID).trim()).filter(id => id && id !== ''));
            const uploadedIds = data.rows.map(row => row.ID).filter(id => id != null && String(id).trim() !== '');
            const uniqueUploadedIds = [...new Set(uploadedIds.map(id => String(id).trim()))];
            
            foundUnmatched = uniqueUploadedIds.filter(id => !baseIdSet.has(id));

        } else if (stepConfig.matchColumn === 'ionMass' && stepConfig.matchColumnBase) {
            const matchMap = new Map(data.rows.filter(row => row.ionMass != null && !isNaN(Number(row.ionMass))).map(row => [Number(row.ionMass).toFixed(3), row]));
            const baseMzKey = stepConfig.matchColumnBase;
            
            newMergedRows = mergedData.rows.map((baseRow, index) => {
                const originalNetTableRow = netTable.rows[index];
                const mzToMatch = originalNetTableRow?.[baseMzKey];
                
                if (mzToMatch === null || mzToMatch === undefined || String(mzToMatch).trim() === '' || isNaN(Number(mzToMatch))) {
                    return baseRow;
                }
                
                const mzValue = Number(mzToMatch).toFixed(3);
                const match = matchMap.get(mzValue);

                if (match) {
                    const newRowData: TableRow = {};
                    stepConfig.appendColumns.forEach(col => newRowData[col] = match[col] ?? null);
                    return { ...baseRow, ...newRowData };
                }
                return baseRow;
            });

            const baseMzSet = new Set(netTable.rows.map(row => {
                const mz = row[baseMzKey];
                return (mz != null && !isNaN(Number(mz))) ? Number(mz).toFixed(3) : null;
            }).filter(mz => mz !== null));
            
            foundUnmatched = data.rows
                .map(row => row.ionMass)
                .filter(mass => mass != null && !isNaN(Number(mass)) && !baseMzSet.has(Number(mass).toFixed(3)));
        }

        const finalMergedData: TableData = { headers: newHeaders, rows: newMergedRows };
        setMergedData(finalMergedData);
        setDataHistory(prev => [...prev.slice(0, currentStep), finalMergedData]);
        showToast(`${stepConfig.name} 匹配成功!`);
        if (foundUnmatched.length > 0) {
            setAllUnmatched(prev => ({ ...prev, [currentStep]: foundUnmatched as (string|number)[] }));
            setUnmatchedItems(foundUnmatched as (string|number)[]);
            setModalTitle(`在 ${stepConfig.name} 步骤中的不匹配项`);
            setModalOpen(true);
        }

        if (currentStep < PROCESSING_STEPS.length - 1) {
            setCurrentStep(currentStep + 1);
        }
      }
    } catch (err: any) {
      setError(err.message || '处理文件时发生未知错误。');
    } finally {
      setIsLoading(false);
    }
  }, [currentStep, mergedData, netTable]);
  
  const handleGenerateAnnotation = useCallback(() => {
    if (!mergedData) {
      setError('没有可用于注释的数据。');
      return;
    }
    setError(null);
    setIsLoading(true);

    const requiredCols = ['Compound_Name', 'name', 'MQScore', 'LibraryQualityString', 'SharedPeaks', 'MZErrorPPM', 'ConfidenceScoreExact'];
    const missingCols = requiredCols.filter(col => !mergedData.headers.includes(col));
    if (missingCols.length > 0) {
        setError(`无法生成注释，因为缺少以下必需列: ${missingCols.join(', ')}。请确保前面的步骤已正确完成。`);
        setIsLoading(false);
        return;
    }

    try {
        const newHeaders = [...mergedData.headers];
        if (!newHeaders.includes('Final_Annotation')) {
            newHeaders.push('Final_Annotation');
        }

        const newRows = mergedData.rows.map(row => {
            const annotation = determineFinalAnnotation(row);
            return { ...row, Final_Annotation: annotation };
        });
        
        const finalData = { headers: newHeaders, rows: newRows };
        setMergedData(finalData);
        setDataHistory(prev => [...prev.slice(0, currentStep), finalData]);
        setCurrentStep(currentStep + 1);
        showToast('最终注释生成成功!');
    } catch (err: any) {
        setError(err.message || '生成注释时发生未知错误。');
    } finally {
        setIsLoading(false);
    }
  }, [mergedData, currentStep]);

  const handleStepDownload = (stepIndex: number) => {
    const data = dataHistory[stepIndex];
    const stepName = PROCESSING_STEPS[stepIndex].name.replace(/\s+/g, '_');
    if (data) {
        exportFile(data, `step_${stepIndex + 1}_${stepName}_result`);
    }
  };

  const handleUseWorkflowDataForDereplication = () => {
    if (mergedData) {
      setDereplicationData(mergedData);
      setIsDereplicated(false);
      setDataBeforeDereplication(null);
      showToast('已将流程数据加载到去重工具中。');
      dereplicationToolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  
  const handleFilterFileProcess = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await parseFile(file);
      if (!data.headers.includes('Final_Annotation')) {
        throw new Error("上传的文件必须包含 'Final_Annotation' 列。");
      }
      setFilterToolData(data);
      setIsFiltered(false);
      setDataBeforeFilter(null);
      showToast('文件已成功加载到过滤工具。');
    } catch (err: any) {
      setError(err.message || '处理文件时发生未知错误。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleContaminantFileProcess = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
        const data = await parseFile(file);
        if (!data.headers.includes('name')) {
            throw new Error("过滤列表文件必须包含 'name' 列。");
        }
        const names = new Set(data.rows.map(row => String(row['name']).trim()).filter(name => name));
        setContaminantList(names);
        setContaminantText('');
        showToast(`已通过文件加载 ${names.size} 个唯一的过滤项。`);
    } catch (err: any) {
        setError(err.message || '处理过滤列表文件时出错。');
    } finally {
        setIsLoading(false);
    }
  }, []);

  const handleProcessPastedList = () => {
    if (!contaminantText.trim()) {
        setError("请粘贴要过滤的名称列表。");
        return;
    }
    const names = new Set(contaminantText.split('\n').map(name => name.trim()).filter(name => name));
    setContaminantList(names);
    showToast(`已通过粘贴加载 ${names.size} 个唯一的过滤项。`);
  };

  const handleApplyFilter = useCallback(() => {
    if (!filterToolData) {
      setError('没有可用于过滤的数据。');
      return;
    }
    if (!contaminantList || contaminantList.size === 0) {
      setError('请先上传或粘贴一个有效的过滤列表。');
      return;
    }
    setError(null);
    setIsLoading(true);

    try {
        setDataBeforeFilter(filterToolData); // Save current state for undo
        const initialRowCount = filterToolData.rows.length;
        const filteredRows = filterToolData.rows.filter(row => {
            const annotationValue = row['Final_Annotation'];
            if (annotationValue === null || annotationValue === undefined) {
                return true; 
            }
            const annotation = String(annotationValue).trim();
            if (annotation === '') {
                return true;
            }
            return !contaminantList.has(annotation);
        });
        const removedCount = initialRowCount - filteredRows.length;

        setFilterToolData({ ...filterToolData, rows: filteredRows });
        setIsFiltered(true);
        showToast(`成功移除 ${removedCount} 个匹配的条目!`);
    } catch (err: any) {
        setError(err.message || '过滤时发生未知错误。');
    } finally {
        setIsLoading(false);
    }
  }, [filterToolData, contaminantList]);

  const handleUndoFilter = () => {
    if (dataBeforeFilter) {
      setFilterToolData(dataBeforeFilter);
      setIsFiltered(false);
      setDataBeforeFilter(null);
      showToast('已撤销过滤操作。');
    }
  };
  
  const handleDownloadFilterResult = () => {
      if (filterToolData) {
        exportFile(filterToolData, 'filtered_data');
      }
  };

  const handleLoadDataForFiltering = () => {
    if (dereplicationData) {
      const cleanedRows = dereplicationData.rows
        .filter(r => (r as any)._derep_status === '保留')
        .map(r => {
            const newRow = {...r};
            delete (newRow as any)._derep_status;
            return newRow;
        });
      const cleanedData = { headers: dereplicationData.headers, rows: cleanedRows };
      setFilterToolData(cleanedData);
      setIsFiltered(false);
      setDataBeforeFilter(null);
      showToast('已将去重数据加载到过滤工具中。');
      filterToolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleDereplicationFileProcess = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await parseFile(file);
      if (!data.headers.includes('Final_Annotation') || !data.headers.includes('ID')) {
        throw new Error("上传的文件必须包含 'Final_Annotation' 和 'ID' 列。");
      }
      setDereplicationData(data);
      setIsDereplicated(false);
      setDataBeforeDereplication(null);
      showToast('文件已成功加载到去重工具。');
    } catch (err: any) {
      setError(err.message || '处理文件时发生未知错误。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleDereplication = useCallback(() => {
    if (!dereplicationData) {
      setError('没有可用于去重的数据。');
      return;
    }
    setError(null);
    setIsLoading(true);

    try {
        setDataBeforeDereplication(dereplicationData);
        const { headers, rows } = dereplicationData;

        const bioCols = headers.filter(h => h.toUpperCase().startsWith('CON_') || h.toUpperCase().startsWith('HBO_'));
        const qcCols = headers.filter(h => h.toUpperCase().startsWith('QC-'));

        if (bioCols.length === 0) throw new Error("未找到生物样本列 (例如 'CON_...' 或 'HBO_...')。");
        if (qcCols.length === 0) throw new Error("未找到QC样本列 (例如 'QC-...')。");
        if (!headers.includes('ID')) throw new Error("数据必须包含 'ID' 列。");

        const groups = new Map<string, TableRow[]>();
        const unknowns: TableRow[] = [];
        
        rows.forEach(row => {
            const annotation = row['Final_Annotation'];
            if (annotation && String(annotation).trim() !== '') {
                const key = String(annotation).trim();
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(row);
            } else {
                unknowns.push(row);
            }
        });

        const processedRows: TableRow[] = [];

        groups.forEach((groupRows) => {
            if (groupRows.length <= 1) {
                processedRows.push({ ...groupRows[0], _derep_status: '保留' });
                return;
            }

            // Stage 1.1 & 1.2
            const candidates = groupRows.map(row => {
                const bioValues = bioCols.map(col => Number(row[col])).filter(v => !isNaN(v));
                const missingCount = bioCols.length - bioValues.filter(v => v > 0).length;
                const missingRate = (missingCount / bioCols.length) * 100;

                if (missingRate > 50) return { ...row, _derep_status: '因缺失率过高而剔除' };

                const qcValues = qcCols.map(col => Number(row[col])).filter(v => !isNaN(v) && v > 0);
                if (qcValues.length < 2) {
                    return { ...row, _qc_rsd: 0 }; // Pass if cannot calculate
                }
                const mean = qcValues.reduce((a, b) => a + b, 0) / qcValues.length;
                if (mean === 0) return { ...row, _derep_status: '因QC不稳定而剔除' };
                const stdDev = Math.sqrt(qcValues.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / (qcValues.length - 1));
                const rsd = (stdDev / mean) * 100;
                
                if (rsd > 30) return { ...row, _derep_status: '因QC不稳定而剔除' };

                return { ...row, _qc_rsd: rsd };
            }).filter(row => !('_derep_status' in row));


            // Stage 2
            let winner: TableRow | null = null;
            if (candidates.length === 1) {
                winner = candidates[0];
            } else if (candidates.length > 1) {
                candidates.forEach((row: any) => {
                    const bioValues = bioCols.map(col => Number(row[col])).filter(v => !isNaN(v) && v > 0);
                    row._avg_intensity = bioValues.length > 0 ? bioValues.reduce((a, b) => a + b, 0) / bioValues.length : 0;
                });
                
                const min_rsd = Math.min(...candidates.map(r => (r as any)._qc_rsd as number));
                const finalCandidates = candidates.filter(r => ((r as any)._qc_rsd as number) < min_rsd + 2);
                
                if (finalCandidates.length > 0) {
                    winner = finalCandidates.reduce((max, row) => (((row as any)._avg_intensity || 0) as number) > (((max as any)._avg_intensity || 0) as number) ? row : max, finalCandidates[0]);
                }
            }

            // Mark results
            groupRows.forEach(row => {
                if (winner && row.ID === winner.ID) {
                    processedRows.push({ ...row, _derep_status: '保留' });
                } else {
                    processedRows.push({ ...row, _derep_status: '删除' });
                }
            });
        });

        const finalRows = [ ...processedRows, ...unknowns.map(row => ({ ...row, _derep_status: '保留' }))];
        finalRows.forEach((row: any) => {
            delete row._qc_rsd;
            delete row._avg_intensity;
        });

        // Ensure original order
        const rowOrderMap = new Map(rows.map((row, index) => [row.ID, index]));
        finalRows.sort((a: any, b: any) => (rowOrderMap.get(a.ID) ?? Infinity) - (rowOrderMap.get(b.ID) ?? Infinity));
        
        setDereplicationData({ ...dereplicationData, rows: finalRows });

        const removedItemsForList = finalRows
            .filter(row => (row as any)._derep_status !== '保留')
            .map(row => `ID: ${(row as any).ID}, Annotation: ${(row as any).Final_Annotation || '未知'} - ${(row as any)._derep_status}`);

        if (removedItemsForList.length > 0) {
            setModalTitle(`移除了 ${removedItemsForList.length} 个冗余或低质量条目`);
            setUnmatchedItems(removedItemsForList.map(item => String(item)));
            setModalOpen(true);
        }

        setIsDereplicated(true);
        showToast('冗杂重复去除成功!');
    } catch (err: any) {
        setError(err.message || '执行去重时发生未知错误。');
    } finally {
        setIsLoading(false);
    }
  }, [dereplicationData]);

  const handleUndoDereplication = () => {
    if (dataBeforeDereplication) {
      setDereplicationData(dataBeforeDereplication);
      setIsDereplicated(false);
      setDataBeforeDereplication(null);
      showToast('已撤销去重操作。');
    }
  };

  const handleDownloadDereplicationResult = () => {
      if (dereplicationData) {
        const finalRows = dereplicationData.rows.filter(r => (r as any)._derep_status === '保留').map(r => {
            const newRow = {...r};
            delete (newRow as any)._derep_status;
            return newRow;
        });
        const dataToDownload = { headers: dereplicationData.headers, rows: finalRows };
        exportFile(dataToDownload, 'dereplicated_data');
      }
    };

  const handleMetaboliteIdentification = async () => {
    if (!msmsData.trim() || !precursorMz.trim()) {
        setError("请输入 Precursor m/z 和 MS/MS 峰数据。");
        return;
    }

    if (identificationSource === 'api' && !apiUrl.trim()) {
        setError("请输入外部鉴定服务的 API 端点 URL。");
        return;
    }

    setIsIdentifying(true);
    setError(null);
    setIdentificationResult(null);
    setApiResult(null);

    try {
        if (identificationSource === 'gemini') {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const prompt = `
                As an expert in metabolomics and mass spectrometry, analyze the following tandem mass spectrometry (MS/MS) data to identify the most likely metabolite.

                Precursor m/z: ${precursorMz}

                MS/MS Peaks (provided as m/z and optional intensity, one per line):
                ${msmsData}
            `;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            compoundName: { type: Type.STRING, description: "The most likely name of the identified metabolite." },
                            confidence: { type: Type.STRING, description: "Confidence level of the identification (High, Medium, Low, or Uncertain)." },
                            reasoning: { type: Type.STRING, description: "A brief, scientific explanation for the identification, referencing key fragment ions from the provided MS/MS data." },
                            molecularFormula: { type: Type.STRING, description: "The predicted molecular formula for the identified compound." },
                            smiles: { type: Type.STRING, description: "The SMILES string representing the compound's structure." },
                        },
                        required: ["compoundName", "confidence", "reasoning"]
                    },
                },
            });

            const resultJson = JSON.parse(response.text);
            setIdentificationResult(resultJson);
        } else { // External API
            const peaks = msmsData.trim().split('\n').map(line => {
                const parts = line.trim().split(/\s+/);
                const mz = parseFloat(parts[0]);
                const intensity = parts.length > 1 ? parseFloat(parts[1]) : null;
                if (isNaN(mz)) return null;
                return { mz, intensity };
            }).filter(p => p !== null);

            const payload = {
                apiKey: apiKey,
                precursorMz: parseFloat(precursorMz),
                peaks: peaks
            };

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`API 请求失败，状态码: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            setApiResult(JSON.stringify(result, null, 2));
        }
        showToast('鉴定成功!');
    } catch (err: any) {
        setError(err.message || '鉴定过程中发生未知错误。');
    } finally {
        setIsIdentifying(false);
    }
  };

  const handleLoadDataForExplanation = () => {
    const dataToUse = filterToolData || dereplicationData;
    if (dataToUse) {
        const retainedAnnotations = dataToUse.rows
            .filter(row => {
                const status = (row as any)._derep_status;
                const isRetained = typeof status === 'undefined' || status === '保留';
                return isRetained && row.Final_Annotation && String(row.Final_Annotation).trim() !== '';
            })
            .map(row => String(row.Final_Annotation).trim());
        
        const uniqueAnnotations = [...new Set(retainedAnnotations)];
        
        if (uniqueAnnotations.length > 0) {
            setExplanationMetabolites(uniqueAnnotations.join('\n'));
            showToast(`已加载 ${uniqueAnnotations.length} 个唯一的代谢物进行解释。`);
            explanationToolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            showToast('在所选结果中未找到可用于解释的已注释代谢物。');
        }
    } else {
        setError("请先在功能区二或三中处理数据。");
    }
  };

  const handleMetaboliteExplanation = async () => {
    if (!explanationMetabolites.trim()) {
        setError("请输入或加载要解释的代谢物名称。");
        return;
    }
    setIsExplaining(true);
    setError(null);

    const metabolites = [...new Set(explanationMetabolites.split('\n').map(m => m.trim()).filter(Boolean))];
    const CHUNK_SIZE = 50;
    
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        const chunks: string[][] = [];
        for (let i = 0; i < metabolites.length; i += CHUNK_SIZE) {
            chunks.push(metabolites.slice(i, i + CHUNK_SIZE));
        }

        const promises = chunks.map(chunk => {
            const prompt = `You are an expert biochemist. For the following list of metabolite names, provide a Chinese translation and a scientific classification for each. Return the result as a JSON array of objects. Each object must have three keys: 'englishName', 'chineseTranslation', and 'classification'.

For the 'classification', use one of the following scientifically sound categories: '内源性代谢物' (Endogenous Metabolite), '外源性化学物' (Xenobiotic, e.g., drugs, contaminants), '植物/微生物代谢物' (Plant/Microbial Metabolite), '化学品/试剂' (Chemical/Reagent), or '未知/不明确' (Unknown/Unclear).

Metabolites:
${chunk.join('\n')}`;
            return ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                englishName: { type: Type.STRING },
                                chineseTranslation: { type: Type.STRING },
                                classification: { type: Type.STRING },
                            },
                            required: ["englishName", "chineseTranslation", "classification"]
                        }
                    },
                },
            });
        });

        const responses = await Promise.all(promises);
        
        const allResultsFromAI = responses.flatMap(response => {
            try {
                return JSON.parse(response.text);
            } catch (e) {
                console.error("Failed to parse AI response chunk:", response.text);
                return []; 
            }
        });
        
        const resultMap = new Map(allResultsFromAI.map((res: any) => [res.englishName, res]));

        const orderedRows = metabolites.map(name => {
            const result = resultMap.get(name);
            return {
                '英文名称': name,
                '中文翻译': result?.chineseTranslation || '翻译失败',
                '分类': result?.classification || '分类失败',
            };
        });

        const tableData: TableData = {
            headers: ['英文名称', '中文翻译', '分类'],
            rows: orderedRows,
        };
        
        exportFile(tableData, '代谢物解释与分类结果');
        showToast('处理完成，文件已开始下载！');

    } catch (err: any) {
        setError(err.message || '解释过程中发生未知错误。');
    } finally {
        setIsExplaining(false);
    }
  };


  const handleDownload = () => {
    let dataToDownload: TableData | null = mergedData;
    let fileName = 'processed_data';

    if (filterToolData) {
        fileName = `filtered_data`;
        dataToDownload = filterToolData;
    } else if (dereplicationData) {
        fileName = 'dereplicated_data';
        const finalRows = dereplicationData.rows.filter(r => (r as any)._derep_status === '保留').map(r => {
            const newRow = {...r};
            delete (newRow as any)._derep_status;
            return newRow;
        });
        dataToDownload = { headers: dereplicationData.headers, rows: finalRows };
    } else if (currentStep > PROCESSING_STEPS.length - 1) {
        fileName = `annotated_data`;
    }
    
    if (dataToDownload) {
      exportFile(dataToDownload, fileName);
    }
  };


  const showUnmatchedModal = (stepIndex: number) => {
    const step = PROCESSING_STEPS[stepIndex];
    const items = allUnmatched[stepIndex];
    if (step && items) {
      setModalTitle(`在 ${step.name} 步骤中的不匹配项`);
      setUnmatchedItems(items);
      setModalOpen(true);
    }
  };

  const displayData = dereplicationData || filterToolData || mergedData;
  
  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'High': return 'text-green-600 bg-green-100 border-green-200';
      case 'Medium': return 'text-yellow-600 bg-yellow-100 border-yellow-200';
      case 'Low': return 'text-orange-600 bg-orange-100 border-orange-200';
      default: return 'text-slate-600 bg-slate-100 border-slate-200';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      <div className="container mx-auto p-4 sm:p-8">
        
        {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}

        <header className="text-center mb-10 p-8 bg-gradient-to-br from-sky-50 to-slate-100 rounded-2xl shadow-inner-lg border border-slate-200">
           <div className="inline-flex items-center justify-center bg-white p-3 rounded-full shadow-md mb-4 border border-slate-200">
                <svg className="w-10 h-10 text-sky-500" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8.5 4.75L10.25 6.5M10.25 6.5L12 8.25M10.25 6.5L8.5 8.25M6.5 12L4.75 10.25M4.75 10.25L3 12M4.75 10.25L6.5 12M12.0001 3L10.2501 4.75M10.2501 4.75L8.50006 3M10.2501 4.75L12.0001 6.5M15.5 4.75L13.75 6.5M13.75 6.5L12 8.25M13.75 6.5L15.5 8.25M17.5 12L19.25 10.25M19.25 10.25L21 12M19.25 10.25L17.5 12M12.0001 21L13.7501 19.25M13.7501 19.25L15.5001 21M13.7501 19.25L12.0001 17.5M8.50006 19.25L10.2501 17.5M10.2501 17.5L12.0001 15.75M10.2501 17.5L8.50006 15.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            </div>
          <h1 className="text-4xl font-bold text-slate-900">代谢组学处理工具</h1>
          <p className="text-lg text-slate-600 mt-2">一个智能、分步的数据整合与注释流程</p>
        </header>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-6" role="alert">
            <strong className="font-bold">错误! </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        )}

        {isLoading && (
            <div className="flex justify-center items-center my-8">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-sky-500"></div>
                <p className="ml-4 text-lg text-slate-700">正在处理...</p>
            </div>
        )}

        <div className="space-y-12">
            
            <section className="bg-white p-8 rounded-2xl border border-slate-200 shadow-xl">
                <h2 className="text-2xl font-bold text-slate-900 mb-6">功能区一：代谢组学处理流程</h2>
                <div className="mb-8">
                  <Stepper steps={PROCESSING_STEPS} currentStep={currentStep} />
                </div>
                {!isLoading && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {PROCESSING_STEPS.map((step, index) => {
                      const Icon = stepIcons[index];
                      return (
                        <div ref={el => { stepRefs.current[index] = el; }} key={step.name} className={`bg-white p-6 rounded-2xl shadow-lg border border-slate-200 transition-all duration-300 ${currentStep === index ? 'ring-2 ring-sky-500 scale-105' : 'opacity-80 hover:opacity-100'}`}>
                          <div className="flex items-center mb-4">
                            <div className="bg-sky-100 p-2 rounded-lg mr-4">
                                <Icon className="w-6 h-6 text-sky-600" />
                            </div>
                            <h3 className="text-xl font-semibold text-slate-900">{step.name}</h3>
                          </div>
                          <p className="text-slate-600 mt-1 mb-4 text-sm">{step.description}</p>
                          
                          {(() => {
                            if (step.fileType === 'annotation') {
                                return (
                                    <button 
                                        onClick={handleGenerateAnnotation}
                                        disabled={currentStep !== index}
                                        className="w-full flex items-center justify-center px-4 py-3 bg-sky-600 text-white rounded-md hover:bg-sky-700 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed font-semibold"
                                    >
                                    生成注释
                                    </button>
                                );
                            }
                            if (index === 1 && currentStep === 1) {
                                return (
                                    <div className="p-6 border-2 border-dashed border-slate-300 rounded-md bg-slate-50 text-center">
                                      <p className="text-sm text-green-700 mb-4">✓ 基础数据已加载并验证。</p>
                                      <button
                                        onClick={() => {
                                          setDataHistory(prev => [...prev, mergedData!]);
                                          setCurrentStep(2);
                                          showToast('数据确认，进入下一步。');
                                        }}
                                        disabled={isLoading}
                                        className="w-full px-4 py-3 bg-sky-600 text-white rounded-md hover:bg-sky-700 transition-colors disabled:bg-slate-400 font-semibold"
                                      >
                                        继续下一步
                                      </button>
                                    </div>
                                );
                            }
                            return (
                                <FileUpload 
                                    onFileSelect={handleFileProcess} 
                                    disabled={currentStep !== index || isLoading} 
                                    title={`点击上传${step.name}`} 
                                />
                            );
                          })()}

                          <div className="mt-4 flex justify-between items-center min-h-[40px]">
                            {allUnmatched[index] && allUnmatched[index].length > 0 ? (
                               <button
                                  onClick={() => showUnmatchedModal(index)}
                                  className="flex items-center text-sm text-amber-600 hover:text-amber-700 transition-colors font-medium"
                                >
                                  <WarningIcon className="w-5 h-5 mr-1" />
                                  查看 {allUnmatched[index].length} 个不匹配项
                                </button>
                            ) : <div />}
                            <button
                                onClick={() => handleStepDownload(index)}
                                disabled={index >= currentStep}
                                className="flex items-center text-sm text-sky-600 hover:text-sky-700 transition-colors font-medium disabled:text-slate-400 disabled:cursor-not-allowed"
                            >
                                <DownloadIcon className="w-4 h-4 mr-1" />
                                下载此步结果
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {currentStep > PROCESSING_STEPS.length - 1 && mergedData && !isLoading && (
                    <div className="mt-8 text-center p-6 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-lg text-green-800 font-semibold mb-4">处理流程已完成！</p>
                        <button
                            onClick={handleUseWorkflowDataForDereplication}
                            className="px-5 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700 transition-colors font-semibold"
                        >
                            将结果用于冗杂重复去除
                        </button>
                    </div>
                )}
            </section>

            <section ref={dereplicationToolRef} className="bg-white p-8 rounded-2xl border border-slate-200 shadow-xl">
                 <div className="flex items-center mb-4">
                    <div className="bg-sky-100 p-2 rounded-lg mr-4">
                        <DocumentDuplicateIcon className="w-6 h-6 text-sky-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900">功能区二：冗杂重复去除</h2>
                </div>
                <p className="text-slate-600 mb-6">对已整合注释的数据进行处理，解决重复鉴定问题，为每个化合物选择唯一的、质量最高的特征峰作为代表。</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    <div>
                         <h3 className="font-semibold text-slate-800 mb-2">第 1 步: 加载数据</h3>
                         <p className="text-xs text-slate-500 mb-4">从上方流程加载或直接上传文件。</p>
                         <FileUpload 
                            onFileSelect={handleDereplicationFileProcess} 
                            disabled={isLoading}
                            title="点击上传待去重文件"
                         />
                         {dereplicationData && (
                           <p className="text-sm text-green-700 mt-2 text-center">
                                ✓ 已加载 {dereplicationData.rows.length} 行数据。
                           </p>
                         )}
                    </div>
                     <div>
                        <h3 className="font-semibold text-slate-800 mb-2">第 2 步: 执行操作</h3>
                        <p className="text-xs text-slate-500 mb-4">处理数据并查看结果。</p>
                         <div className="p-6 border-2 border-dashed border-slate-300 rounded-md bg-slate-50 text-center">
                            {!isDereplicated ? (
                                <button
                                    onClick={handleDereplication}
                                    disabled={!dereplicationData || isLoading}
                                    className="w-full px-5 py-3 bg-sky-600 text-white rounded-md hover:bg-sky-700 transition-colors disabled:bg-slate-400 font-semibold"
                                >
                                    执行去重
                                </button>
                            ) : (
                                <div className="space-y-3">
                                <button
                                    onClick={handleUndoDereplication}
                                    disabled={isLoading}
                                    className="w-full px-5 py-3 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors disabled:bg-slate-400 font-semibold"
                                >
                                    撤销去重
                                </button>
                                 <button
                                    onClick={handleDownloadDereplicationResult}
                                    disabled={isLoading}
                                    className="w-full flex items-center justify-center px-5 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:bg-slate-400 font-semibold"
                                >
                                    <DownloadIcon className="w-5 h-5 mr-2"/>
                                    下载去重结果
                                </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                {isDereplicated && (
                    <div className="mt-6 text-center">
                        <button
                            onClick={handleLoadDataForFiltering}
                            className="px-5 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700 transition-colors font-semibold"
                        >
                           将结果用于污染物过滤
                        </button>
                    </div>
                )}
            </section>
            
            <section ref={filterToolRef} className="bg-white p-8 rounded-2xl border border-slate-200 shadow-xl">
                 <div className="flex items-center mb-4">
                    <div className="bg-sky-100 p-2 rounded-lg mr-4">
                        <FilterIcon className="w-6 h-6 text-sky-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900">功能区三：自定义污染物过滤</h2>
                </div>
                <p className="text-slate-600 mb-6">通过上传自定义列表，移除数据中的特定条目。您可以从上方流程加载数据，或直接上传一个待过滤的文件。</p>
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                        <h3 className="font-semibold text-slate-800 mb-2">第 1 步: 加载主数据</h3>
                        <p className="text-xs text-slate-500 mb-4">从上方流程加载或直接上传文件。</p>
                         <FileUpload 
                            onFileSelect={handleFilterFileProcess} 
                            disabled={isLoading}
                            title="上传待过滤文件"
                         />
                         {filterToolData && (
                           <p className="text-sm text-green-700 mt-2 text-center">
                                ✓ 已加载 {filterToolData.rows.length} 行数据。
                           </p>
                         )}
                    </div>
                     <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-4">
                        <div>
                            <h3 className="font-semibold text-slate-800 mb-2">第 2 步: 提供过滤列表</h3>
                            <p className="text-xs text-slate-500 mb-4">上传文件 (需含 "name" 列) 或直接粘贴列表。</p>
                            <FileUpload 
                                onFileSelect={handleContaminantFileProcess} 
                                disabled={isLoading}
                                title="上传过滤列表文件"
                            />
                        </div>
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                <div className="w-full border-t border-slate-300" />
                            </div>
                            <div className="relative flex justify-center">
                                <span className="bg-slate-50 px-2 text-sm text-slate-500">或</span>
                            </div>
                        </div>
                        <div>
                             <textarea
                                rows={4}
                                value={contaminantText}
                                onChange={(e) => setContaminantText(e.target.value)}
                                placeholder="每行粘贴一个要过滤的名称"
                                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-sm"
                                disabled={isLoading}
                            />
                            <button
                                onClick={handleProcessPastedList}
                                disabled={isLoading || !contaminantText.trim()}
                                className="mt-2 w-full px-4 py-2 bg-white text-sky-700 border border-sky-500 rounded-md hover:bg-sky-50 transition-colors disabled:bg-slate-200 disabled:text-slate-500 disabled:border-slate-300 text-sm font-semibold"
                            >
                                处理粘贴的列表
                            </button>
                        </div>
                         {contaminantList && (
                             <p className="text-sm text-green-700 mt-2 text-center">
                                ✓ 已加载 {contaminantList.size} 个过滤项。
                             </p>
                         )}
                    </div>

                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                        <h3 className="font-semibold text-slate-800 mb-2">第 3 步: 执行操作</h3>
                        <p className="text-xs text-slate-500 mb-4">应用过滤列表并查看结果。</p>
                        <div className="text-center space-y-3">
                            {!isFiltered ? (
                                <button
                                    onClick={handleApplyFilter}
                                    disabled={!filterToolData || !contaminantList || isLoading}
                                    className="w-full px-5 py-3 bg-sky-600 text-white rounded-md hover:bg-sky-700 transition-colors disabled:bg-slate-400 font-semibold"
                                >
                                    应用过滤列表
                                </button>
                            ) : (
                                <>
                                <button
                                    onClick={handleUndoFilter}
                                    disabled={isLoading}
                                    className="w-full px-5 py-3 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors disabled:bg-slate-400 font-semibold"
                                >
                                    撤销过滤
                                </button>
                                <button
                                    onClick={handleDownloadFilterResult}
                                    disabled={isLoading}
                                    className="w-full flex items-center justify-center px-5 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:bg-slate-400 font-semibold"
                                >
                                    <DownloadIcon className="w-5 h-5 mr-2"/>
                                    下载过滤结果
                                </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                 {(isFiltered) && (
                    <div className="mt-6 text-center">
                        <button
                            onClick={handleLoadDataForExplanation}
                            className="px-5 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700 transition-colors font-semibold"
                        >
                           将结果用于 AI 批量解释
                        </button>
                    </div>
                )}
            </section>

            <section ref={identificationToolRef} className="bg-white p-8 rounded-2xl border border-slate-200 shadow-xl">
                 <div className="flex items-center mb-4">
                    <div className="bg-sky-100 p-2 rounded-lg mr-4">
                        <MagnifyingGlassIcon className="w-6 h-6 text-sky-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900">功能区四：辅助代谢物鉴定</h2>
                </div>
                <p className="text-slate-600 mb-6">利用 AI 模型或外部 API，根据您提供的 Precursor m/z 和 MS/MS 峰列表来鉴定最有可能的代谢物。</p>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-slate-700 mb-2">选择鉴定源</label>
                            <div className="flex items-center space-x-4">
                                <label className="flex items-center">
                                    <input type="radio" name="id-source" value="gemini" checked={identificationSource === 'gemini'} onChange={() => setIdentificationSource('gemini')} className="h-4 w-4 text-sky-600 border-slate-300 focus:ring-sky-500" />
                                    <span className="ml-2 text-sm text-slate-700">Google Gemini</span>
                                 </label>
                                <label className="flex items-center">
                                    <input type="radio" name="id-source" value="api" checked={identificationSource === 'api'} onChange={() => setIdentificationSource('api')} className="h-4 w-4 text-sky-600 border-slate-300 focus:ring-sky-500" />
                                    <span className="ml-2 text-sm text-slate-700">外部 API</span>
                                </label>
                            </div>
                        </div>

                        {identificationSource === 'api' && (
                            <div className="space-y-4 mb-4 p-4 bg-slate-50 border border-slate-200 rounded-md">
                                <div>
                                    <label htmlFor="api-url" className="block text-sm font-medium text-slate-700 mb-1">鉴定服务 API 端点</label>
                                    <input
                                        type="url"
                                        id="api-url"
                                        value={apiUrl}
                                        onChange={(e) => setApiUrl(e.target.value)}
                                        placeholder="https://api.example.com/identify"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                                        disabled={isIdentifying}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="api-key" className="block text-sm font-medium text-slate-700 mb-1">API 密钥 (可选)</label>
                                    <input
                                        type="text"
                                        id="api-key"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder="输入您的 API Key"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                                        disabled={isIdentifying}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="mb-4">
                            <label htmlFor="precursor-mz" className="block text-sm font-medium text-slate-700 mb-1">Precursor m/z</label>
                            <input
                                type="number"
                                id="precursor-mz"
                                value={precursorMz}
                                onChange={(e) => setPrecursorMz(e.target.value)}
                                placeholder="例如: 194.0817"
                                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500"
                                disabled={isIdentifying}
                            />
                        </div>
                        <div>
                            <label htmlFor="msms-data" className="block text-sm font-medium text-slate-700 mb-1">MS/MS 峰列表</label>
                            <textarea
                                id="msms-data"
                                rows={10}
                                value={msmsData}
                                onChange={(e) => setMsmsData(e.target.value)}
                                placeholder="每行一个峰，格式为 m/z intensity (强度可选)&#10;例如:&#10;83.0863 100&#10;111.0805 50&#10;138.0655 80"
                                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 font-mono text-sm"
                                disabled={isIdentifying}
                            />
                        </div>
                        <button
                            onClick={handleMetaboliteIdentification}
                            disabled={isIdentifying || !precursorMz || !msmsData}
                            className="mt-4 w-full flex items-center justify-center px-5 py-3 bg-sky-600 text-white rounded-md hover:bg-sky-700 transition-colors disabled:bg-slate-400 font-semibold"
                        >
                            {isIdentifying ? (
                                <><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div> 正在鉴定...</>
                            ) : "开始鉴定"}
                        </button>
                    </div>
                    <div className="bg-slate-50 p-6 rounded-lg border border-slate-200">
                        <h3 className="font-semibold text-slate-800 mb-4">鉴定结果</h3>
                        {isIdentifying && (
                            <div className="text-center text-slate-500">
                                <p>正在分析数据，请稍候...</p>
                            </div>
                        )}
                        {!isIdentifying && !identificationResult && !apiResult && (
                             <div className="text-center text-slate-500">
                                <p>结果将显示在此处。</p>
                            </div>
                        )}
                        {identificationResult && (
                            <div className="space-y-4 text-sm">
                                <div>
                                    <p className="font-semibold text-slate-800">化合物名称:</p>
                                    <p className="text-lg font-bold text-sky-700">{identificationResult.compoundName}</p>
                                </div>
                                 <div>
                                    <p className="font-semibold text-slate-800">置信度:</p>
                                    <p className={`inline-block px-2 py-1 rounded-md font-medium text-xs border ${getConfidenceColor(identificationResult.confidence)}`}>{identificationResult.confidence}</p>
                                </div>
                                {identificationResult.molecularFormula && (
                                    <div>
                                        <p className="font-semibold text-slate-800">分子式:</p>
                                        <p className="text-slate-700 font-mono">{identificationResult.molecularFormula}</p>
                                    </div>
                                )}
                                {identificationResult.smiles && (
                                     <div>
                                        <p className="font-semibold text-slate-800">SMILES:</p>
                                        <p className="text-slate-700 font-mono break-all">{identificationResult.smiles}</p>
                                    </div>
                                )}
                                <div>
                                    <p className="font-semibold text-slate-800">鉴定依据:</p>
                                    <p className="text-slate-600 leading-relaxed whitespace-pre-wrap">{identificationResult.reasoning}</p>
                                </div>
                            </div>
                        )}
                        {apiResult && (
                             <div>
                                <p className="font-semibold text-slate-800 mb-2">来自外部 API 的响应:</p>
                                <pre className="text-xs bg-white p-3 rounded-md border border-slate-200 whitespace-pre-wrap break-all overflow-x-auto"><code>{apiResult}</code></pre>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <section ref={explanationToolRef} className="bg-white p-8 rounded-2xl border border-slate-200 shadow-xl">
                <div className="flex items-center mb-4">
                    <div className="bg-sky-100 p-2 rounded-lg mr-4">
                        <ChatBubbleLeftRightIcon className="w-6 h-6 text-sky-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900">功能区五：AI 批量翻译与分类</h2>
                </div>
                <p className="text-slate-600 mb-6">利用 AI 模型对您的代谢物列表进行批量翻译和科学分类。此功能支持数千个条目，处理完成后将直接生成 Excel 文件供您下载。</p>

                <div className="p-6 border-2 border-dashed border-slate-300 rounded-md bg-slate-50">
                    <div>
                        <div className="flex justify-between items-center mb-1">
                             <label htmlFor="metabolite-list" className="block text-sm font-medium text-slate-700">代谢物列表</label>
                             <button
                                onClick={handleLoadDataForExplanation}
                                className="text-sm font-medium text-sky-600 hover:text-sky-800"
                                disabled={isExplaining}
                             >
                                从最新结果加载
                             </button>
                        </div>
                        <textarea
                            id="metabolite-list"
                            rows={12}
                            value={explanationMetabolites}
                            onChange={(e) => setExplanationMetabolites(e.target.value)}
                            placeholder="每行粘贴一个代谢物名称&#10;例如:&#10;L-Proline&#10;Caffeine"
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 font-mono text-sm"
                            disabled={isExplaining}
                        />
                         <button
                            onClick={handleMetaboliteExplanation}
                            disabled={isExplaining || !explanationMetabolites.trim()}
                            className="mt-4 w-full flex items-center justify-center px-5 py-3 bg-sky-600 text-white rounded-md hover:bg-sky-700 transition-colors disabled:bg-slate-400 font-semibold"
                        >
                            {isExplaining ? (
                                <><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div> 正在后台处理...</>
                            ) : "开始处理并下载"}
                        </button>
                        <p className="text-xs text-slate-500 mt-2 text-center">对于大型列表，处理可能需要几分钟。请勿关闭此窗口。</p>
                    </div>
                </div>
            </section>
        </div>

        <div className="mt-8 flex justify-center space-x-4">
            <button
              onClick={() => setResetModalOpen(true)}
              className="px-6 py-3 bg-white border border-slate-300 text-slate-700 rounded-md hover:bg-slate-100 transition-colors font-semibold"
            >
              重新开始
            </button>
            <button
              onClick={handleDownload}
              disabled={!displayData}
              className="px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:bg-slate-400 font-semibold flex items-center"
            >
              <DownloadIcon className="w-5 h-5 mr-2" />
              下载最终结果
            </button>
        </div>
        
        <div className="mt-12">
           <DataTable data={displayData} />
        </div>

        <div className="mt-12 bg-white p-8 rounded-2xl border border-slate-200 shadow-xl">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">数据处理流程说明</h2>
          <div className="prose prose-slate max-w-none text-slate-600">
            <p>本工具现在包含五大核心功能区，您可以根据需求选择使用：</p>
            
            <h3 className="font-semibold text-slate-800">功能区一：代谢组学处理流程</h3>
            <p>这是一个包含 6 个步骤的引导式工作流，旨在将来自不同来源的数据进行整合与注释。完成所有步骤后，您可以选择将生成的结果直接发送到后续的功能区进行进一步处理。在每一步完成后，您都可以下载该步骤的中间结果文件。</p>
            <ul>
              <li>
                <strong>第 1 步: Mzmine导出数据增列</strong>
                <p>这是流程的起点。您可以上传 Mzmine 直接导出的原始文件 (需包含 <code>Filename</code> 列) 或已预处理的“净表” (需包含 <code>ID</code>, <code>MZ</code>, <code>RT</code> 列)。工具会自动检测文件类型：如果检测到 <code>Filename</code> 列，它将自动从中提取并生成 <code>ID</code>, <code>MZ</code>, 和 <code>RT</code> 三个新列；如果这些列已存在，则直接验证并进入下一步。</p>
              </li>
              <li>
                <strong>第 2 步: 上传净表</strong>
                <p>此步骤用于确认您的基础数据已成功加载并符合后续处理的要求 (必须包含 <code>ID</code> 和 <code>MZ</code> 列)。确认无误后，请点击“继续下一步”以解锁后续的匹配功能。</p>
              </li>
              <li>
                <strong>第 3 步: 匹配FBMN (Feature-Based Molecular Networking)</strong>
                <p>上传 FBMN 的特征文件。工具会读取此文件，并使用其 <code>ID</code> 列与基础“净表”的 <code>ID</code> 列进行匹配。匹配成功后，会将 FBMN 文件中的 <code>Compound_Name</code>, <code>NAME (中文翻译)</code>, <code>Adduct</code>, <code>LibraryQualityString</code>, <code>MQScore</code>, <code>MZErrorPPM</code>, 和 <code>SharedPeaks</code> 列的数据追加到基础表的对应行。</p>
              </li>
              <li>
                <strong>第 4 步: 匹配Sirius</strong>
                <p>上传 Sirius 的匹配结果文件。与上一步类似，工具会使用 <code>ID</code> 列进行匹配，并将 Sirius 文件中的 <code>name</code>, <code>molecularFormula</code>, <code>ConfidenceScoreExact</code>, <code>smiles</code>, <code>ConfidenceScoreApproximate</code>, 和 <code>InChIkey2D</code> 列的数据追加到对应行。</p>
              </li>
              <li>
                <strong>第 5 步: 匹配补充列</strong>
                <p>上传一个补充信息文件。此步骤的匹配方式比较特殊：它会使用补充文件的 <code>ionMass</code> 列去匹配基础“净表”的 <code>MZ</code> 列。为了确保精度，两个值都会被<strong>保留到小数点后 3 位</strong>进行比较。匹配成功后，会将补充文件中的 <code>molecularFormula</code>, <code>NPC#superclass</code>, <code>ClassyFire#superclass</code>, <code>ClassyFire#class</code>, 和 <code>InChI</code> 列的数据追加到对应行。</p>
              </li>
              <li>
                <strong>第 6 步: 生成最终注释</strong>
                <p>这是流程的核心步骤。工具会新增一列 <code>Final_Annotation</code>，并根据一套复杂的逻辑规则，智能地为每个物质选择最可靠的注释。这个决策过程会综合评估 FBMN 和 Sirius 的结果质量。</p>
              </li>
            </ul>
            
            <h3 className="font-semibold text-slate-800">功能区二：冗杂重复去除 (Feature Dereplication)</h3>
            <p>此工具用于解决 <code>Final_Annotation</code> 列中存在的重复鉴定问题，确保最终输出的表格中，每一个已知的化合物名称只由唯一一个、质量最高的特征峰来代表。</p>
             <p><strong>使用前提:</strong> 输入文件必须包含 <code>ID</code> 列, <code>Final_Annotation</code> 列, 一系列生物样本列 (如 <code>CON_...</code>, <code>HBO_...</code>), 以及一系列QC样本列 (如 <code>QC-...</code>)。</p>
            <p><strong>处理规则:</strong></p>
            <ol>
              <li><strong>初步质控:</strong> 对于每一个重复注释的化合物，工具会先进行两轮筛选：
                <ul>
                  <li><strong>缺失率过滤:</strong> 如果某个特征在生物样本中的缺失率超过 <strong>50%</strong>，它将被剔除。</li>
                  <li><strong>QC稳定性过滤:</strong> 如果某个特征在QC样本中的相对标准偏差 (RSD) 超过 <strong>30%</strong>，它也将被剔除。</li>
                </ul>
              </li>
              <li><strong>选举唯一代表:</strong> 在通过初步质控的特征中，工具会进行两轮“投票”来选出最佳代表：
                <ul>
                  <li><strong>第一轮 (稳定性优先):</strong> 选出所有QC RSD值在最小RSD值+2%范围内的候选者。</li>
                  <li><strong>第二轮 (丰度决胜):</strong> 从这些最终候选者中，选择在生物样本中平均丰度最高的一个作为最终的“当选代表”。</li>
                </ul>
              </li>
              <li><strong>最终输出:</strong> 所有“当选代表”和未被注释的物质将被保留，其余所有重复的、被淘汰的特征都将被标记为删除。下载的结果将只包含被保留的行。</li>
            </ol>

            <h3 className="font-semibold text-slate-800">功能区三：自定义污染物过滤</h3>
            <p>此工具用于根据您提供的自定义列表来过滤数据。它遵循一个清晰的三步流程：</p>
            <ol>
              <li><strong>加载主数据:</strong> 您可以将在“功能区二”处理好的数据直接加载到此处，也可以上传一个新的待过滤文件。</li>
              <li><strong>提供过滤列表:</strong> 您可以上传一个包含要移除条目名称的列表文件（CSV 或 XLSX 格式，必须包含一个名为 <code>name</code> 的列），也可以直接在文本框中粘贴一个名称列表（每行一个）。</li>
              <li><strong>执行操作:</strong> 工具将从主数据中移除所有在 <code>Final_Annotation</code> 列中的值与您过滤列表中 <code>name</code> 列的值相匹配的行。</li>
            </ol>
            
            <h3 className="font-semibold text-slate-800">功能区四：辅助代谢物鉴定</h3>
            <p>这是一个利用AI大模型或外部API进行代谢物鉴定的实验性功能。您只需提供前体离子的质荷比 (Precursor m/z) 和其对应的二级质谱峰列表 (MS/MS Peaks)，鉴定服务就会像一位代谢组学专家一样，分析这些碎片信息，并给出最有可能的化合物鉴定结果。您可以选择使用内置的 Google Gemini 模型，或连接到您选择的任何外部鉴定网站的 API。</p>
            
            <h3 className="font-semibold text-slate-800">功能区五：AI 批量翻译与分类</h3>
            <p>这是一个强大的批量处理工具，专注于翻译和分类您的代谢物列表。您可以直接从“功能区三”加载经过优化的 <code>Final_Annotation</code> 列表，或手动粘贴数千个您感兴趣的代谢物名称。工具会利用 AI 模型在后台进行处理，为每个代谢物提供中文翻译和科学分类（如内源性、外源性等）。处理完成后，会自动生成一个包含“英文名称”、“中文翻译”和“分类”三列的 Excel 文件供您下载。</p>

          </div>
        </div>

      </div>
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={modalTitle} unmatchedItems={unmatchedItems} />
      <ConfirmationModal 
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        onConfirm={handleReset}
        title="确认重置"
        message="您确定要清除所有上传的文件和处理进度吗？此操作无法撤销。"
      />
    </div>
  );
};

export default App;
