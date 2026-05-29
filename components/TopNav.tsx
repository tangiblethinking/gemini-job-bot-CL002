"use client";
import React from 'react';
import Image from 'next/image';

export default function TopNav() {
  return (
    <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm px-6 py-3 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <Image
          src="https://cdn.myportfolio.com/abc1e0ab-7370-4502-8c78-92428397bf66/15a26956-0efa-4a8d-be26-27a030f18db9.png?h=6a5aea5f291cc6ed6573f41e6a765bf2"
          alt="Ape X Job Hunt"
          width={120}
          height={32}
          style={{ objectFit: 'contain', height: '32px', width: 'auto' }}
          priority
          unoptimized
        />
      </div>
    </nav>
  );
}
