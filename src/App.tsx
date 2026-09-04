import React, { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import {
  auth,
  subscribeToAuth,
  hasAdminClaim,
  signInWithGoogle,
  logOut,
  syncUserProfile,
  fetchUserEntries,
  saveUserEntry,
  deleteUserEntry,
} from './lib/firebase';
import { JournalEntry } from './types';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { JournalEditor } from './components/JournalEditor';
import { HistorySidebar } from './components/HistorySidebar';
import { InsightsModal } from './components/InsightsModal';
import { SecurityModal } from './components/SecurityModal';
import { SourcesPanel } from './components/SourcesPanel';
import { ThreatFeed } from './components/ThreatFeed';
import { PermissionsPanel } from './components/PermissionsPanel';
import { PerimeterLogPanel } from './components/PerimeterLogPanel';
import { RedTeamConsole } from './components/RedTeamConsole';
import { AdminPanel } from './components/AdminPanel';
import { listArtifacts } from './lib/perimeterApi';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Journal entries & active editor state
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeEntry, setActiveEntry] = useState<JournalEntry | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // Persistence status
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // Layout & Modals
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [isThreatFeedOpen, setIsThreatFeedOpen] = useState(false);
  const [isPermissionsOpen, setIsPermissionsOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [isRedTeamOpen, setIsRedTeamOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // Artifact ids available to ground reflections. Empty until the user
  // connects a source, which is what keeps the plain journal path in play.
  const [groundingArtifactIds, setGroundingArtifactIds] = useState<string[]>([]);

  // Create a clean template for a new journal reflection
  const createNewEntryTemplate = useCallback((uid: string): JournalEntry => {
    return {
      id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userId: uid,
      title: '',
      content: '',
      category: 'Personal',
      mood: 'Reflective',
      mode: 'companion',
      turns: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, []);

  // Load entries for user
  const loadUserEntries = useCallback(async (currentUser: User) => {
    setEntriesLoading(true);
    setSaveError(null);
    try {
      const userEntries = await fetchUserEntries(currentUser.uid);
      setEntries(userEntries);

      if (userEntries.length > 0) {
        setActiveEntry(userEntries[0]);
      } else {
        const fresh = createNewEntryTemplate(currentUser.uid);
        setActiveEntry(fresh);
      }
    } catch (err: any) {
      console.error('Failed to load user entries from Firestore:', err);
      setSaveError(err?.message || 'Could not load your journal entries.');
      // Create a fallback local entry so user can still type
      setActiveEntry(createNewEntryTemplate(currentUser.uid));
    } finally {
      setEntriesLoading(false);
    }
  }, [createNewEntryTemplate]);

  /**
   * Loads the ids of ingested artifacts so reflections can be grounded in real
   * project context. A failure here is non-fatal by design: the journal must
   * keep working without external context, so this degrades to the ungrounded
   * path rather than blocking the user.
   */
  // Stable identity. An inline arrow here would give the prop a new identity
  // every render, which is what caused the SourcesPanel render loop.
  const handleArtifactsChanged = useCallback((artifacts: { id: string }[]) => {
    setGroundingArtifactIds(artifacts.map((a) => a.id));
  }, []);

  const loadGroundingArtifacts = useCallback(async () => {
    try {
      const artifacts = await listArtifacts();
      setGroundingArtifactIds(artifacts.map((a) => a.id));
    } catch (err) {
      console.warn('Could not load connected sources; reflections will be ungrounded.', err);
      setGroundingArtifactIds([]);
    }
  }, []);

  // Listen to Auth State
  useEffect(() => {
    const unsubscribe = subscribeToAuth(async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        await syncUserProfile(currentUser);
        // Amendment E: the claim decides whether the entry point is shown.
        // The server re-checks it on every request regardless.
        setIsAdmin(await hasAdminClaim(currentUser));
        await loadUserEntries(currentUser);
        await loadGroundingArtifacts();
      } else {
        setIsAdmin(false);
        setEntries([]);
        setActiveEntry(null);
        setGroundingArtifactIds([]);
      }
    });

    return () => unsubscribe();
  }, [loadUserEntries, loadGroundingArtifacts]);

  // Sign In Handler
  const handleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const signedInUser = await signInWithGoogle();
      setUser(signedInUser);
      await syncUserProfile(signedInUser);
      await loadUserEntries(signedInUser);
      await loadGroundingArtifacts();
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      setAuthError(err?.message || 'Failed to sign in with Google. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Sign Out Handler
  const handleSignOut = async () => {
    try {
      await logOut();
      setUser(null);
      setEntries([]);
      setActiveEntry(null);
    } catch (err: any) {
      console.error('Sign Out failed:', err);
    }
  };

  // Create New Reflection
  const handleNewEntry = () => {
    if (!user) return;
    const fresh = createNewEntryTemplate(user.uid);
    setActiveEntry(fresh);
  };

  // Select existing entry
  const handleSelectEntry = (entry: JournalEntry) => {
    setActiveEntry(entry);
  };

  // Save Entry to Firestore
  const handleSaveEntry = async (updatedEntry: JournalEntry) => {
    if (!user) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      await saveUserEntry(user.uid, updatedEntry);
      setActiveEntry(updatedEntry);

      // Update in entries list
      setEntries((prev) => {
        const index = prev.findIndex((e) => e.id === updatedEntry.id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = updatedEntry;
          return next;
        } else {
          return [updatedEntry, ...prev];
        }
      });

      setLastSavedAt(new Date().toLocaleTimeString());
    } catch (err: any) {
      console.error('Failed to save to Firestore:', err);
      setSaveError(err?.message || 'Failed to save reflection to Firestore.');
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  // Delete Entry
  const handleDeleteEntry = async (entryId: string) => {
    if (!user) return;
    try {
      await deleteUserEntry(user.uid, entryId);
      const remaining = entries.filter((e) => e.id !== entryId);
      setEntries(remaining);

      if (activeEntry?.id === entryId) {
        if (remaining.length > 0) {
          setActiveEntry(remaining[0]);
        } else {
          handleNewEntry();
        }
      }
    } catch (err: any) {
      console.error('Failed to delete entry:', err);
      setSaveError(err?.message || 'Failed to delete reflection from Firestore.');
    }
  };

  // Loading screen during initial auth verification
  if (authLoading && !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#fcfaf7]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-3 border-[#5a5a40] border-t-transparent" />
          <p className="font-serif text-sm text-[#434338]">Connecting to ReflectAI Vault...</p>
        </div>
      </div>
    );
  }

  // Unauthenticated Landing Page
  if (!user) {
    return (
      <div className="min-h-screen bg-[#fcfaf7] flex flex-col font-sans">
        <Navbar
          user={null}
          entryCount={0}
          onNewEntry={() => {}}
          onOpenInsights={() => {}}
          onOpenSecurity={() => setIsSecurityOpen(true)}
          onOpenSources={() => {}}
          onOpenThreatFeed={() => {}}
          onOpenPermissions={() => {}}
          onOpenLog={() => {}}
          onOpenRedTeam={() => {}}
          onSignOut={() => {}}
        />
        <LandingPage
          onSignIn={handleSignIn}
          isLoading={authLoading}
          error={authError}
        />
        <SecurityModal
          isOpen={isSecurityOpen}
          onClose={() => setIsSecurityOpen(false)}
        />
      </div>
    );
  }

  // Authenticated Workspace
  return (
    <div className="h-screen flex flex-col bg-[#fcfaf7] overflow-hidden font-sans">
      <Navbar
        user={user}
        entryCount={entries.length}
        onNewEntry={handleNewEntry}
        onOpenInsights={() => setIsInsightsOpen(true)}
        onOpenSecurity={() => setIsSecurityOpen(true)}
        onOpenSources={() => setIsSourcesOpen(true)}
        onOpenThreatFeed={() => setIsThreatFeedOpen(true)}
        onOpenPermissions={() => setIsPermissionsOpen(true)}
        onOpenLog={() => setIsLogOpen(true)}
        onOpenRedTeam={() => setIsRedTeamOpen(true)}
        isAdmin={isAdmin}
        onOpenAdmin={() => setIsAdminOpen(true)}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* History Sidebar */}
        <HistorySidebar
          entries={entries}
          activeEntryId={activeEntry?.id || null}
          onSelectEntry={handleSelectEntry}
          onNewEntry={handleNewEntry}
          onDeleteEntry={handleDeleteEntry}
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen((prev) => !prev)}
        />

        {/* Main Journal Editor */}
        <main className="flex-1 h-full overflow-hidden flex flex-col">
          {activeEntry ? (
            <JournalEditor
              groundingArtifactIds={groundingArtifactIds}
              key={activeEntry.id}
              entry={activeEntry}
              onSave={handleSaveEntry}
              onDelete={handleDeleteEntry}
              isSaving={isSaving}
              saveError={saveError}
              lastSavedAt={lastSavedAt}
              isFirstRun={entries.length === 0}
              onOpenRedTeam={() => setIsRedTeamOpen(true)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-[#8a8a75]">
              <div className="text-center space-y-2">
                <p className="font-serif text-lg text-[#2c2c24]">No active reflection</p>
                <button
                  onClick={handleNewEntry}
                  className="rounded-lg bg-[#5a5a40] px-4 py-2 text-xs font-medium text-white hover:bg-[#484833] cursor-pointer"
                >
                  Start New Reflection
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      <InsightsModal
        isOpen={isInsightsOpen}
        onClose={() => setIsInsightsOpen(false)}
        entries={entries}
      />
      <SecurityModal
        isOpen={isSecurityOpen}
        onClose={() => setIsSecurityOpen(false)}
      />
      <SourcesPanel
        isOpen={isSourcesOpen}
        onClose={() => setIsSourcesOpen(false)}
        onArtifactsChanged={handleArtifactsChanged}
      />
      <ThreatFeed
        isOpen={isThreatFeedOpen}
        onClose={() => setIsThreatFeedOpen(false)}
      />
      <PermissionsPanel
        isOpen={isPermissionsOpen}
        onClose={() => setIsPermissionsOpen(false)}
      />
      <PerimeterLogPanel
        isOpen={isLogOpen}
        onClose={() => setIsLogOpen(false)}
      />
      <AdminPanel isOpen={isAdminOpen} onClose={() => setIsAdminOpen(false)} />

      <RedTeamConsole
        isOpen={isRedTeamOpen}
        onClose={() => setIsRedTeamOpen(false)}
      />
    </div>
  );
}
