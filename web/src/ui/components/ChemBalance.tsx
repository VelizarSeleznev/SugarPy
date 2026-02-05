import React, { useState } from 'react';
import { ReactionInput } from './ReactionInput';
import { reactionToPlain } from '../utils/reactionFormat';

const DEFAULT_CODE = (reaction: string) =>
  `from sugarpy.chem import balance_equation\nprint(balance_equation('${reaction}'))`;

type Props = {
  onRun: (code: string) => Promise<void>;
  kernelReady: boolean;
};

export function ChemBalance({ onRun, kernelReady }: Props) {
  const [reaction, setReaction] = useState('');
  const [lastResult, setLastResult] = useState('');

  const runBalance = async () => {
    const normalized = reactionToPlain(reaction);
    await onRun(DEFAULT_CODE(normalized.replace(/'/g, "\\'")));
    setLastResult('Balanced equation inserted into a new cell.');
  };

  return (
    <div className="chem-balance">
      <ReactionInput
        value={reaction}
        onChange={setReaction}
        placeholder="H2 + O2 -> H2O"
        ariaLabel="Reaction"
      />
      <div className="chem-actions">
        <button
          className="button"
          onClick={runBalance}
          disabled={!kernelReady || !reaction.trim()}
        >
          Balance
        </button>
        {lastResult ? <span className="chem-result">{lastResult}</span> : null}
      </div>
    </div>
  );
}
