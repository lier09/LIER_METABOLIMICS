
export type TableRow = Record<string, string | number | null>;

export interface TableData {
  headers: string[];
  rows: TableRow[];
}

export interface ProcessingStep {
  name: string;
  description: string;
  // FIX: Added 'mzmine' to the fileType union type to allow it as a valid value.
  fileType: 'mzmine' | 'netTable' | 'fbmn' | 'sirius' | 'supplementary' | 'annotation';
  requiredColumns: string[];
  matchColumn: string;
  matchColumnBase?: string;
  appendColumns: string[];
}

export interface IdentificationResult {
  compoundName: string;
  confidence: 'High' | 'Medium' | 'Low' | 'Uncertain';
  reasoning: string;
  molecularFormula?: string;
  smiles?: string;
}