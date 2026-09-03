import React from 'react';
import { X, ShieldCheck, Lock, KeyRound, Database, Server } from 'lucide-react';

interface SecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SecurityModal: React.FC<SecurityModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 anim-backdrop flex items-center justify-center bg-[#2c2c24]/50 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#fcfaf7] p-6 shadow-xl border border-[#e5e0d3] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#e5e0d3] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f3efe6] border border-[#e5e0d3] text-[#5a5a40]">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <h2 className="font-serif text-lg font-semibold text-[#2c2c24]">
                Security & Isolation Architecture
              </h2>
              <p className="text-xs text-[#8a8a75]">
                Multi-layer protection meeting OWASP & Firestore Standards
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#8a8a75] hover:bg-[#f3efe6] hover:text-[#2c2c24] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 space-y-4 text-xs text-[#434338] leading-relaxed">
          <div className="rounded-xl border border-[#e5e0d3] bg-white p-4 flex items-start gap-3 shadow-2xs">
            <Database className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-[#2c2c24] text-sm">
                Cloud Firestore Owner-Bound Security Rules
              </h4>
              <p className="mt-1 text-[#434338]">
                All document reads, writes, and queries enforce <code className="bg-[#f3efe6] border border-[#e5e0d3] px-1 py-0.5 rounded text-[#5a5a40] font-mono">request.auth.uid == userId</code>. Unauthenticated access and cross-user data exposure are strictly rejected at the database engine level.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#e5e0d3] bg-white p-4 flex items-start gap-3 shadow-2xs">
            <Lock className="h-5 w-5 text-[#5a5a40] shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-[#2c2c24] text-sm">
                Passwordless Federated Google Authentication
              </h4>
              <p className="mt-1 text-[#434338]">
                No user passwords or raw credentials are ever handled, stored, or managed in the custom application code. User identity is securely verified through Google Identity Services and Firebase Authentication.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#e5e0d3] bg-white p-4 flex items-start gap-3 shadow-2xs">
            <Server className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-[#2c2c24] text-sm">
                Server-Side Gemini API Proxy & Secret Isolation
              </h4>
              <p className="mt-1 text-[#434338]">
                The Gemini API key is kept server-side in environment variables and Google Secret Manager. The client browser never receives or exposes the API key.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#e5e0d3] bg-white p-4 flex items-start gap-3 shadow-2xs">
            <KeyRound className="h-5 w-5 text-[#8a8a75] shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-[#2c2c24] text-sm">
                Resilient Fallback Ladder & Zero-Undefined Payload Hygiene
              </h4>
              <p className="mt-1 text-[#434338]">
                API requests utilize an automatic model fallback ladder (<code className="font-mono bg-[#f3efe6] border border-[#e5e0d3] px-1 py-0.5 rounded text-[#5a5a40]">gemini-3.6-flash &rarr; gemini-3.1-flash-lite &rarr; gemini-flash-latest &rarr; gemini-3.7-flash</code>) with status code error recovery. All Firestore payloads undergo sanitization to strip <code className="font-mono text-[#5a5a40]">undefined</code> values before database writes.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-[#e5e0d3] flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl bg-[#5a5a40] px-4 py-2 text-xs font-medium text-white hover:bg-[#484833] cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
