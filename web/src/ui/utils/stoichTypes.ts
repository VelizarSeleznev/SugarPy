export type StoichState = {
  reaction: string;
  inputs: Record<string, { n?: string; m?: string }>;
};

export type StoichSpecies = {
  name: string;
  side: 'reactant' | 'product';
  coeff: number;
  molar_mass?: number | null;
  input_n?: number | null;
  input_m?: number | null;
  calc_n?: number | null;
  calc_m?: number | null;
  status?: 'ok' | 'mismatch';
};

export type StoichOutput = {
  ok: boolean;
  error?: string | null;
  balanced?: string | null;
  equation_latex?: string | null;
  species: StoichSpecies[];
};
