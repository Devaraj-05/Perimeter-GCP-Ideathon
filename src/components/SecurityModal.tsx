import React from 'react';
import { X, ShieldCheck, Lock, KeyRound, Database, Server } from 'lucide-react';

interface SecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SecurityModal: React.FC<SecurityModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 anim-backdrop flex items-center justify-center bg-[#1a1a1a]/50 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#ffffff] p-6 shadow-xl border border-[#e5e5e5] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f7f7f8] border border-[#e5e5e5] text-[#1a1a1a]">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <h2 className="font-serif text-lg font-semibold text-[#1a1a1a]">
                Security & Isolation Architecture
              </h2>
              <p className="text-xs text-[#6b6b6b]">
                Multi-layer protection meeting OWASP & Firestore Standards
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#6b6b6b] hover:bg-[#f7f7f8] hover:text-[#1a1a1a] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 space-y-4 text-xs text-[#3f3f3f] leading-relaxed">
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 flex items-start gap-3 shadow-2xs">
            <Database className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-[#1a1a1a] text-sm">
                Cloud Firestore Owner-Bound Security Rules
              </h4>
              <p className="mt-1 text-[#3f3f3f]">
                All document reads, writes, and queries enforce <code className="bg-[#f7f7f8] border border-[#e5e5e5] px-1 py-0.5 rounded text-[#1a1a1a] font-mono">request.auth.uid == userId</code>. Unauthenticated access and cross-user data exposure are strictly rejected at the database engine level.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 flex items-start gap-3 shadow-2xs">
            <Lock className="h-5 w-5 text-[#1a1a1a] shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-[#1a1a1a] text-sm">
                Passwordless Federated Google Authentication
              </h4>
              <p className="mt-1 text-[#3f3f3f]">
                No user passwords or raw credentials are ever handled, stored, or managed in the custom application code. User identity is securely verified through Google Identity Services and Firebase Authentication.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 flex items-start gap-3 shadow-2xs">
            <Server className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-[#1a1a1a] text-sm">
                Server-Side Gemini API Proxy & Secret Isolation
              </h4>
              <p className="mt-1 text-[#3f3f3f]">
                The Gemini API key is kept server-side in environment variables and Google Secret Manager. The client browser never receives or exposes the API key.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 flex items-start gap-3 shadow-2xs">
            <KeyRound className="h-5 w-5 text-[#6b6b6b] shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-[#1a1a1a] text-sm">
                Resilient Fallback Ladder & Zero-Undefined Payload Hygiene
              </h4>
              <p className="mt-1 text-[#3f3f3f]">
                API requests utilize an automatic model fallback ladder (<code className="font-mono bg-[#f7f7f8] border border-[#e5e5e5] px-1 py-0.5 rounded text-[#1a1a1a]">gemini-3.6-flash &rarr; gemini-3.1-flash-lite &rarr; gemini-flash-latest &rarr; gemini-3.7-flash</code>) with status code error recovery. All Firestore payloads undergo sanitization to strip <code className="font-mono text-[#1a1a1a]">undefined</code> values before database writes.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-[#e5e5e5] flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl bg-[#1a1a1a] px-4 py-2 text-xs font-medium text-white hover:bg-[#000000] cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
