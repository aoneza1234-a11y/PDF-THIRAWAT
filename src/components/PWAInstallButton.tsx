import React, { useState } from 'react';
import { MonitorDown } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
      >
        <MonitorDown className="w-3.5 h-3.5" />
        <span>ติดตั้งแอปลงเครื่อง (PWA)</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <MonitorDown className="w-3.5 h-3.5" />
          <span>ติดตั้งบน iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-lg bg-white border border-slate-200 p-6 shadow-xl">
              <h3 className="text-base font-semibold text-slate-900">
                ติดตั้งแอปบน iPhone / iPad
              </h3>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                1. แตะปุ่ม <strong>Share</strong> บนแถบเครื่องมือ Safari
                <br />
                2. เลื่อนลงแล้วเลือก <strong>Add to Home Screen</strong>
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-md bg-slate-900 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
