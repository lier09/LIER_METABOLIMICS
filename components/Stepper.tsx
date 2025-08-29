
import React from 'react';
import { CheckIcon } from './icons';

interface StepperProps {
  steps: { name: string }[];
  currentStep: number;
}

export const Stepper: React.FC<StepperProps> = ({ steps, currentStep }) => {
  return (
    <nav aria-label="Progress">
      <ol role="list" className="flex items-center">
        {steps.map((step, stepIdx) => (
          <li key={step.name} className={`relative ${stepIdx !== steps.length - 1 ? 'pr-8 sm:pr-20' : ''}`}>
            {stepIdx < currentStep ? (
              <>
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="h-0.5 w-full bg-sky-600" />
                </div>
                <div className="relative flex h-8 w-8 items-center justify-center bg-sky-600 rounded-full hover:bg-sky-700">
                  <CheckIcon className="h-5 w-5 text-white" />
                  <span className="sr-only">{step.name}</span>
                </div>
              </>
            ) : stepIdx === currentStep ? (
              <>
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="h-0.5 w-full bg-slate-200" />
                </div>
                <div className="relative flex h-8 w-8 items-center justify-center bg-white rounded-full border-2 border-sky-600" aria-current="step">
                  <span className="h-2.5 w-2.5 bg-sky-600 rounded-full" aria-hidden="true" />
                  <span className="sr-only">{step.name}</span>
                </div>
              </>
            ) : (
              <>
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="h-0.5 w-full bg-slate-200" />
                </div>
                <div className="relative flex h-8 w-8 items-center justify-center bg-white rounded-full border-2 border-slate-300 hover:border-slate-400">
                  <span className="h-2.5 w-2.5 bg-transparent rounded-full" aria-hidden="true" />
                  <span className="sr-only">{step.name}</span>
                </div>
              </>
            )}
             <p className="absolute -bottom-6 w-max text-xs text-center text-slate-500">{step.name}</p>
          </li>
        ))}
      </ol>
    </nav>
  );
};