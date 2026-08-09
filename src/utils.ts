import CryptoJS from 'crypto-js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PanEntry {
  id: string;
  name: string;
  pan: string;
}

export interface IpoOption {
  id: string;
  name: string;
}

export interface HistoryEntry {
  id: string;
  ipoName: string;
  investorName: string;
  panMasked: string;
  applicationNumber: string;
  registrarName: string;
  allotmentStatus: string;
  sharesAllotted: string;
  issuePrice: string;
  verificationTimestamp: number;
}

export interface WorkflowState {
  isRunning: boolean;
  targetIpos: IpoOption[];
  ipoIndex: number;
  panIndex: number;
  status: string;
  isAwaitingResult?: boolean;
}

// ─── DB (Chrome Storage) ──────────────────────────────────────────────────────

const SECRET = 'BSE_EXT_SECRET_123';

export const db = {
  async getPans(): Promise<PanEntry[]> {
    const data = await chrome.storage.local.get('pans');
    if (!data.pans) return [];
    try {
      const bytes = CryptoJS.AES.decrypt(data.pans as string, SECRET);
      return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    } catch {
      return [];
    }
  },
  async savePans(pans: PanEntry[]) {
    const encrypted = CryptoJS.AES.encrypt(JSON.stringify(pans), SECRET).toString();
    await chrome.storage.local.set({ pans: encrypted });
  },
  async getHistory(): Promise<HistoryEntry[]> {
    const data = await chrome.storage.local.get('history');
    return (data.history as HistoryEntry[]) || [];
  },
  async addHistoryEntry(entry: HistoryEntry) {
    const history = await this.getHistory();
    history.push(entry);
    await chrome.storage.local.set({ history });
  },
  async getWorkflowState(): Promise<WorkflowState> {
    const data = await chrome.storage.local.get('workflow');
    return (data.workflow as WorkflowState) || { isRunning: false, targetIpos: [], ipoIndex: 0, panIndex: 0, status: 'Idle' };
  },
  async setWorkflowState(state: Partial<WorkflowState>) {
    const current = await this.getWorkflowState();
    await chrome.storage.local.set({ workflow: { ...current, ...state } });
  }
};
