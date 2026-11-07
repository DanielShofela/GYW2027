import React from 'react';

export const ArtBackground: React.FC = () => {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 select-none opacity-40">
      {/* Halftone subtle dot pattern */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(#111111 0.75px, transparent 0.75px)',
          backgroundSize: '24px 24px',
          opacity: 0.12,
        }}
      />

      {/* Pop Art Organic Star bursts and graphic accents */}
      {/* Top right energy splash */}
      <div className="absolute -top-16 -right-16 w-80 h-80 rounded-full bg-[#FFD21F] opacity-30 blur-2xl transform rotate-12" />

      {/* Top left electric burst */}
      <div className="absolute top-40 -left-20 w-72 h-72 rounded-full bg-[#2457FF] opacity-20 blur-3xl" />

      {/* Center magenta flash */}
      <div className="absolute top-1/2 right-10 w-64 h-64 rounded-full bg-[#E83DFF] opacity-20 blur-3xl" />

      {/* Bottom orange pulse */}
      <div className="absolute bottom-10 left-10 w-96 h-96 rounded-full bg-[#FF6A00] opacity-25 blur-3xl" />

    </div>
  );
};
