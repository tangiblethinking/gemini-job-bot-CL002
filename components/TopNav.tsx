"use client";
import React, { useState } from 'react';
import Image from 'next/image';
import { useApp } from '@/context/AppContext';

export default function TopNav() {
  const { resetAll } = useApp();
  const [showConfirm, setShowConfirm] = useState(false);

  const handleLogoClick = () => setShowConfirm(true);

  const handleConfirm = () => {
    setShowConfirm(false);
    resetAll();
  };

  const handleCancel = () => setShowConfirm(false);

  return (
    <>
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button
            onClick={handleLogoClick}
            className="focus:outline-none hover:opacity-75 transition-opacity cursor-pointer"
            aria-label="Reset app to default state"
            title="Reset app"
          >
            <Image
              src="https://cdn.myportfolio.com/abc1e0ab-7370-4502-8c78-92428397bf66/15a26956-0efa-4a8d-be26-27a030f18db9.png?h=6a5aea5f291cc6ed6573f41e6a765bf2"
              alt="Ape X Job Hunt"
              width={120}
              height={32}
              style={{ objectFit: 'contain', height: '32px', width: 'auto' }}
              priority
              unoptimized
            />
          </button>
        </div>
      </nav>

      {/* Reset confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-gray-900 font-semibold text-base">Reset all values?</h2>
              <p className="text-gray-500 text-sm leading-relaxed">
                This clears your resume, API keys, job results, and all saved data. This cannot be undone.
              </p>
            </div>
            <div className="flex gap-3 mt-1">
              <button
                onClick={handleCancel}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium px-4 py-2.5 rounded-xl text-sm transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-medium px-4 py-2.5 rounded-xl text-sm transition"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
