import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Calendar,
  ChevronRight,
  Filter,
  Trash2,
  Tag,
  BookOpen,
  Plus,
  MoreVertical,
  Pencil,
} from 'lucide-react';
import { JournalEntry, CategoryType } from '../types';

interface HistorySidebarProps {
  entries: JournalEntry[];
  activeEntryId: string | null;
  onSelectEntry: (entry: JournalEntry) => void;
  onNewEntry: () => void;
  onDeleteEntry: (entryId: string) => void;
  /** Renames an entry in place. Titles are generated, so they need correcting. */
  onRenameEntry: (entryId: string, title: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

/** Which entry's row menu is open, if any. */
type MenuState = { id: string } | null;

const CATEGORIES: ('All' | CategoryType)[] = [
  'All',
  'Personal',
  'Career & Ambition',
  'Mindfulness & Gratitude',
  'Ideas & Brainstorming',
  'Relationships',
  'Learning',
];

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  entries,
  activeEntryId,
  onSelectEntry,
  onNewEntry,
  onDeleteEntry,
  onRenameEntry,
  isOpen,
  onToggle,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [menu, setMenu] = useState<MenuState>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);

  // A menu with no way out is a trap. Escape and any outside click close it.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  const [selectedCategory, setSelectedCategory] = useState<'All' | CategoryType>('All');

  // Filter entries
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const matchesSearch =
        searchQuery.trim() === '' ||
        entry.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (entry.summary && entry.summary.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (entry.tags && entry.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())));

      const matchesCat =
        selectedCategory === 'All' || entry.category === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [entries, searchQuery, selectedCategory]);

  // Group entries by date
  const groupedEntries = useMemo<Record<string, JournalEntry[]>>(() => {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    const groups: { [key: string]: JournalEntry[] } = {
      Today: [],
      Yesterday: [],
      'This Month': [],
      Earlier: [],
    };

    filteredEntries.forEach((entry) => {
      const entryDate = new Date(entry.createdAt).toDateString();
      if (entryDate === today) {
        groups.Today.push(entry);
      } else if (entryDate === yesterday) {
        groups.Yesterday.push(entry);
      } else {
        const diffDays =
          (Date.now() - new Date(entry.createdAt).getTime()) / (1000 * 3600 * 24);
        if (diffDays <= 30) {
          groups['This Month'].push(entry);
        } else {
          groups.Earlier.push(entry);
        }
      }
    });

    return groups;
  }, [filteredEntries]);

  return (
    <aside
      className={`border-r border-[#e5e0d3] bg-[#f3efe6] flex flex-col transition-all duration-300 z-10 ${
        isOpen
          ? 'w-80 sm:w-96'
          : 'w-0 sm:w-16 overflow-hidden border-r-0 sm:border-r'
      }`}
    >
      {/* Sidebar Top Header */}
      <div className="p-4 border-b border-[#e5e0d3] flex items-center justify-between bg-[#f3efe6]">
        {isOpen ? (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[#5a5a40]" />
              <h2 className="font-serif text-sm font-semibold text-[#2c2c24]">
                Journal History
              </h2>
              <span className="rounded-full bg-white border border-[#e5e0d3] px-2 py-0.5 text-[10px] font-medium text-[#5a5a40]">
                {entries.length}
              </span>
            </div>
            <button
              id="sidebar-new-entry-btn"
              onClick={onNewEntry}
              className="p-1.5 rounded-lg bg-[#5a5a40] text-white hover:bg-[#484833] transition-colors cursor-pointer"
              title="Start a new reflection"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 mx-auto">
            <button
              onClick={onToggle}
              className="p-2 rounded-lg hover:bg-[#e5e0d3] text-[#5a5a40] transition-colors cursor-pointer"
              title="Expand history"
            >
              <BookOpen className="h-5 w-5" />
            </button>
            <button
              onClick={onNewEntry}
              className="p-2 rounded-lg bg-[#5a5a40] text-white hover:bg-[#484833] transition-colors cursor-pointer"
              title="New reflection"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {isOpen && (
        <>
          {/* Search and Filters */}
          <div className="p-3 border-b border-[#e5e0d3] space-y-2 bg-[#f8f6f0]">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#8a8a75]" />
              <input
                id="search-history-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search reflections & insights..."
                className="w-full rounded-lg border border-[#e5e0d3] bg-white pl-8 pr-3 py-1.5 text-xs text-[#2c2c24] placeholder:text-[#8a8a75] focus:border-[#5a5a40] focus:outline-hidden"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                id="filter-category-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as any)}
                className="flex-1 rounded-md border border-[#e5e0d3] bg-white px-2 py-1 text-[11px] text-[#434338] focus:outline-hidden"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* List of Entries */}
          <div className="flex-1 overflow-y-auto p-2 space-y-4">
            {filteredEntries.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#8a8a75]">
                <p className="font-serif text-sm text-[#2c2c24] mb-1">No reflections found</p>
                <p>Start writing a new entry or adjust your filter query.</p>
              </div>
            ) : (
              Object.entries(groupedEntries).map(([groupTitle, groupItems]: [string, JournalEntry[]]) => {
                if (groupItems.length === 0) return null;
                return (
                  <div key={groupTitle} className="space-y-1.5">
                    <div className="px-2 text-[10px] font-semibold tracking-wider uppercase text-[#8a8a75]">
                      {groupTitle}
                    </div>

                    {groupItems.map((item) => {
                      const isActive = item.id === activeEntryId;
                      return (
                        <div
                          key={item.id}
                          onClick={() => onSelectEntry(item)}
                          className={`group relative flex flex-col p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            isActive
                              ? 'border-[#5a5a40] bg-[#5a5a40] text-white shadow-2xs'
                              : 'border-[#e5e0d3] bg-white hover:border-[#d8d2c2] hover:bg-[#faf8f4] text-[#434338]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            {renaming?.id === item.id ? (
                              <input
                                autoFocus
                                value={renaming.value}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setRenaming({ id: item.id, value: e.target.value })}
                                onBlur={() => {
                                  const v = renaming.value.trim();
                                  if (v && v !== item.title) onRenameEntry(item.id, v);
                                  setRenaming(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  if (e.key === 'Escape') setRenaming(null);
                                }}
                                className="min-w-0 flex-1 rounded border border-[#5a5a40] bg-white px-1.5 py-0.5 font-serif text-xs font-semibold text-[#2c2c24] focus:outline-hidden"
                              />
                            ) : (
                              <h4
                                className={`font-serif text-xs font-semibold line-clamp-1 ${
                                  isActive ? 'text-white' : 'text-[#2c2c24]'
                                }`}
                              >
                                {item.title || 'Untitled Reflection'}
                              </h4>
                            )}
                            <span
                              className={`text-[10px] shrink-0 ${
                                isActive ? 'text-[#e5e0d3]' : 'text-[#8a8a75]'
                              }`}
                            >
                              {new Date(item.createdAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          </div>

                          <div className="flex items-center justify-end mt-1 text-[10px]">
                            <div className="flex items-center gap-1">
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenu(menu?.id === item.id ? null : { id: item.id });
                                  }}
                                  className={`p-1 rounded transition-opacity ${
                                    menu?.id === item.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                  } ${isActive ? 'text-stone-300 hover:text-white' : 'text-[#8a8a75] hover:text-[#2c2c24]'}`}
                                  title="More"
                                  aria-haspopup="menu"
                                  aria-expanded={menu?.id === item.id}
                                >
                                  <MoreVertical className="h-3 w-3" />
                                </button>

                                {menu?.id === item.id && (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border border-[#e5e0d3] bg-white py-1 shadow-lg"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRenaming({ id: item.id, value: item.title || '' });
                                        setMenu(null);
                                      }}
                                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[#434338] hover:bg-[#f3efe6]"
                                    >
                                      <Pencil className="h-3 w-3" /> Rename
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMenu(null);
                                        if (confirm('Delete this reflection?')) onDeleteEntry(item.id);
                                      }}
                                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[11px] text-red-600 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-3 w-3" /> Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </aside>
  );
};
