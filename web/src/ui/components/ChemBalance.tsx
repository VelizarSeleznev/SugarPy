import React, { useState } from 'react';

const DEFAULT_CODE = (reaction: string) =>
  `from sugarpy.chem import balance_equation\nprint(balance_equation('${reaction}'))`;

type Props = {
  onRun: (code: string) => Promise<void>;
  kernelReady: boolean;
};

export function ChemBalance({ onRun, kernelReady }: Props) {
  const [reaction, setReaction] = useState('H2 + O2 -> H2O');
  const [lastResult, setLastResult] = useState('');

  const runBalance = async () => {
    await onRun(DEFAULT_CODE(reaction.replace(/'/g, "\\'")));
    setLastResult('Balanced equation inserted into a new cell.');
  };

  return (
    <div>
      <h3 className="brand" style={{ fontSize: 20 }}>Chem Balance</h3>
      <p className="subtitle">Paste a reaction without coefficients.</p>
      <input
        className="input"
        value={reaction}
        onChange={(e) => setReaction(e.target.value)}
      />
      <button className="button" onClick={runBalance} disabled={!kernelReady}>
        Balance Reaction
      </button>
      {lastResult ? <div className="output">{lastResult}</div> : null}
    </div>
  );
}
