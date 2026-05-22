export type { Miner, MinerTopRepo } from '@/types/entities';

export type Mode = 'total' | 'oss' | 'discovery';

export interface MinerView {
  mode: Mode;
  score: number;
  cred: number;
  eligible: boolean;
  usd: number;
  counts: {
    primaryLabel: 'Merged' | 'Solved' | 'Done';
    primary: number;
    open: number;
    closed: number;
  };
}

export type Tone = 'neutral' | 'success' | 'danger' | 'done' | 'accent';

export type SortDir = 'asc' | 'desc';

export type ColumnAlign = 'left' | 'right' | 'center';
