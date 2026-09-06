import React, { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import {
  auth,
  subscribeToAuth,
  hasAdminClaim,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  sendPasswordReset,
  describeAuthError,
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
import { ErrorBoundary } from './components/ErrorBoundary';
import { SourcesPanel } from './components/SourcesPanel';
import { PermissionsPanel } from './components/PermissionsPanel';
import { PerimeterLogPanel } from './components/PerimeterLogPanel';
import { RedTeamConsole } from './components/RedTeamConsole';
import { AdminPanel } from './components/AdminPanel';
import { listArtifacts } from './lib/perimeterApi';
import { useRoute, navigate, replacePath, isPublicRoute } from './lib/router';
import { InsightsPage } from './pages/InsightsPage';
import { ActivityPage } from './pages/ActivityPage';
import { SecurityPage } from './pages/SecurityPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  /** Confirmations that are not errors, e.g. a reset link being sent. */
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Journal entries & active editor state
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  /** True when older entries exist beyond the page the sidebar loaded. */
  const [entriesTruncated, setEntriesTruncated] = useState(false);
  const [activeEntry, setActiveEntry] = useState<JournalEntry | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // Persistence status
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // Layout & Modals.
  //
  // Insights, Activity, Security and Settings used to be four more booleans
  // here. They are routes now: each is a place with a URL you can link to,
  // refresh, and leave with the back button.
  const route = useRoute();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
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
      const { entries: userEntries, truncated } = await fetchUserEntries(currentUser.uid);
      setEntries(userEntries);
      // Surfaced, not swallowed. A history that quietly stops at 200 is
      // indistinguishable from data loss to the person who wrote entry 201.
      setEntriesTruncated(truncated);

      // Always open on a blank entry, never on the last one.
      //
      // Reopening the previous conversation puts whatever was last attached
      // back in front of the user before they have asked anything, and the
      // history is one click away in the sidebar. A new session starts empty.
      setActiveEntry(createNewEntryTemplate(currentUser.uid));
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
  /**
   * Renames an entry. Titles are generated from content, so they will
   * sometimes be wrong — a generated title the user cannot correct is worse
   * than no title.
   */
  const handleRenameEntry = useCallback(
    async (entryId: string, title: string) => {
      const existing = entries.find((e) => e.id === entryId);
      if (!user || !existing) return;
      const updated = { ...existing, title, updatedAt: new Date().toISOString() };
      setEntries((prev) => prev.map((e) => (e.id === entryId ? updated : e)));
      setActiveEntry((prev) => (prev && prev.id === entryId ? updated : prev));
      try {
        await saveUserEntry(user.uid, updated);
      } catch (err: any) {
        setSaveError(err?.message || 'Could not rename that reflection.');
      }
    },
    [entries, user],
  );

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

  /**
   * A signed-out visitor on a private route goes back to the landing page.
   *
   * The guard lives here rather than in the router because this is where auth
   * state is known, and a router that reads auth is a router that can be wrong
   * about it. `replacePath`, not `navigate`: pushing would trap the back
   * button on the very path we just refused.
   *
   * It waits for `authLoading` to settle. Redirecting during the initial token
   * check would bounce a signed-in user off their own deep link every reload.
   */
  useEffect(() => {
    if (authLoading) return;
    if (!user && !isPublicRoute(route)) replacePath('/');
  }, [authLoading, user, route]);

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
      // Same treatment as the email path. This previously showed err.message,
      // which is Firebase's own wording and carries internal detail (INV-10) —
      // the test written for the new path caught it on the old one.
      // The code, always. The generic fallback is reached exactly when the
      // table has no entry, and without the code in the console there is no
      // way to learn which one to add.
      console.error('Google Sign-In failed:', err?.code, '(see describeAuthError)');
      setAuthError(describeAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  /**
   * Email and password — a deliberate deviation from Directive 3, made at the
   * project owner's instruction after the conflict was raised.
   *
   * One path for both sign-in and sign-up: everything after authentication is
   * identical, and two copies of the profile sync and the entry load would be
   * two places to forget one. The password is not held in any state here — it
   * arrives as an argument, goes to the Firebase SDK, and is gone.
   */
  const afterSignIn = async (signedInUser: any) => {
    setUser(signedInUser);
    await syncUserProfile(signedInUser);
    await loadUserEntries(signedInUser);
    await loadGroundingArtifacts();
  };

  const handleEmailAuth = async (
    email: string,
    password: string,
    mode: 'in' | 'up',
  ) => {
    setAuthLoading(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      const signedInUser =
        mode === 'in'
          ? await signInWithEmail(email, password)
          : await signUpWithEmail(email, password);
      await afterSignIn(signedInUser);
    } catch (err: any) {
      // describeAuthError, never err.message: Firebase messages carry internal
      // detail and sometimes the address itself (INV-10). The code is logged,
      // the credential never is.
      console.error('Email sign-in failed:', err?.code, '(see describeAuthError)');
      setAuthError(describeAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePasswordReset = async (email: string) => {
    setAuthError(null);
    setAuthNotice(null);
    try {
      await sendPasswordReset(email);
    } catch (err: any) {
      console.error('Password reset failed:', err?.code);
    } finally {
      // The same words whether or not an account exists. Confirming which
      // addresses are registered would turn this button into a user-enumeration
      // oracle, which is the thing Firebase collapses invalid-credential to
      // avoid.
      setAuthNotice('If an account exists for that address, a reset link is on its way.');
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
      <div className="flex h-screen w-screen items-center justify-center bg-[#ffffff]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-3 border-[#1a1a1a] border-t-transparent" />
          <p className="font-serif text-sm text-[#3f3f3f]">Connecting to ReflectAI Vault...</p>
        </div>
      </div>
    );
  }

  // Unauthenticated. Two public routes: the landing page and the security
  // explainer, which a reviewer must be able to read without an account.
  if (!user) {
    return (
      <div className="flex min-h-dvh flex-col bg-[#ffffff] font-sans">
        <Navbar
          user={null}
          entryCount={0}
          onNewEntry={() => {}}
          onOpenInsights={() => {}}
          onOpenSecurity={() => navigate('/security')}
          onOpenSettings={() => {}}
          onOpenSources={() => {}}
          onOpenThreatFeed={() => {}}
          onOpenPermissions={() => {}}
          onOpenLog={() => {}}
          onOpenRedTeam={() => {}}
          onSignOut={() => {}}
        />
        {route === '/security' ? (
          <SecurityPage />
        ) : (
          <LandingPage
            onSignIn={handleSignIn}
            onEmailSignIn={(email, password) => void handleEmailAuth(email, password, 'in')}
            onEmailSignUp={(email, password) => void handleEmailAuth(email, password, 'up')}
            onPasswordReset={(email) => void handlePasswordReset(email)}
            notice={authNotice}
            isLoading={authLoading}
            error={authError}
          />
        )}
      </div>
    );
  }

  // Authenticated.
  //
  // The Navbar is unchanged: it still calls onOpenInsights and the rest, and
  // every element id it renders still exists. Only what those callbacks DO
  // changed, from setting a boolean to navigating. That keeps the demo script
  // and the Inspect menu's index-based divider intact.
  const navbar = (
    <Navbar
      user={user}
      entryCount={entries.length}
      onNewEntry={handleNewEntry}
      onOpenInsights={() => navigate('/insights')}
      onOpenSecurity={() => navigate('/security')}
      onOpenSettings={() => navigate('/settings')}
      onOpenSources={() => setIsSourcesOpen(true)}
      onOpenThreatFeed={() => navigate('/activity')}
      onOpenPermissions={() => setIsPermissionsOpen(true)}
      onOpenLog={() => setIsLogOpen(true)}
      onOpenRedTeam={() => setIsRedTeamOpen(true)}
      isAdmin={isAdmin}
      onOpenAdmin={() => setIsAdminOpen(true)}
      onSignOut={handleSignOut}
    />
  );

  // Full pages. They scroll the document rather than an inner panel, so they
  // are outside the workspace's overflow-hidden shell.
  if (route !== '/') {
    return (
      <div className="flex min-h-dvh flex-col bg-white font-sans">
        {navbar}
        <ErrorBoundary label="This page">
          {route === '/insights' && (
            <InsightsPage
              entries={entries}
              loading={entriesLoading}
              truncated={entriesTruncated}
            />
          )}
          {route === '/activity' && <ActivityPage />}
          {route === '/security' && <SecurityPage />}
          {/* Amendment N. onDeleted runs AFTER the server has confirmed the
              account is gone: the local sign-out is cleanup, not the deletion,
              and doing it first would leave a user believing they had deleted
              an account that still existed. */}
          {route === '/settings' && (
            <SettingsPage
              onDeleted={() => {
                navigate('/');
                void handleSignOut();
              }}
            />
          )}
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#ffffff] overflow-hidden font-sans">
      {navbar}

      <div className="flex-1 flex overflow-hidden">
        {/* History Sidebar */}
        <ErrorBoundary label="Your history">
        <HistorySidebar
          loading={entriesLoading}
          truncated={entriesTruncated}
          entries={entries}
        onRenameEntry={handleRenameEntry}
          activeEntryId={activeEntry?.id || null}
          onSelectEntry={handleSelectEntry}
          onNewEntry={handleNewEntry}
          onDeleteEntry={handleDeleteEntry}
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen((prev) => !prev)}
        />
        </ErrorBoundary>

        {/* Main Journal Editor */}
        <main className="flex-1 h-full overflow-hidden flex flex-col">
          {activeEntry ? (
            <ErrorBoundary label="The editor">
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
              onAttached={() => void loadGroundingArtifacts()}
            />
            </ErrorBoundary>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-[#6b6b6b]">
              <div className="text-center space-y-2">
                <p className="font-serif text-lg text-[#1a1a1a]">No active reflection</p>
                <button
                  onClick={handleNewEntry}
                  className="rounded-lg bg-[#1a1a1a] px-4 py-2 text-xs font-medium text-white hover:bg-[#000000] cursor-pointer"
                >
                  Start New Reflection
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* What remains a modal, and why: these are inspectors you open beside
          the conversation and dismiss without losing your place. Insights,
          Activity, Security and Settings became pages because you go TO them. */}
      <SourcesPanel
        isOpen={isSourcesOpen}
        onClose={() => setIsSourcesOpen(false)}
        onArtifactsChanged={handleArtifactsChanged}
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
