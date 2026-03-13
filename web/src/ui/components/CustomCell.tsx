import React from 'react';
import { CustomCellData, RegressionCellOutput, RegressionCellState } from '../utils/customCellTypes';
import { RegressionCell } from './RegressionCell';

type Props = {
  cell: CustomCellData;
  isRunning?: boolean;
  kernelReady: boolean;
  showOutput?: boolean;
  onChange: (cell: CustomCellData) => void;
  onCompute: (cell: CustomCellData, options?: { exportBindings?: boolean }) => void;
};

export function CustomCell({ cell, isRunning, kernelReady, showOutput = true, onChange, onCompute }: Props) {
  if (cell.templateId === 'regression') {
    return (
      <RegressionCell
        state={cell.state as RegressionCellState}
        output={cell.output as RegressionCellOutput | undefined}
        isRunning={isRunning}
        kernelReady={kernelReady}
        showOutput={showOutput}
        onChange={(state) => onChange({ ...cell, state })}
        onCompute={(state, options) => onCompute({ ...cell, state }, options)}
      />
    );
  }

  return <div className="stoich-error">Unknown custom cell template.</div>;
}
