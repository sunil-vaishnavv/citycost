import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Calendar,
  Check,
  Copy,
  Eye,
  FlaskConical,
  MoreVertical,
  Trash2,
  X,
} from 'lucide-react';
import type { Cluster, Topic } from '../api';
import { Badge, Button, Card, StatusPill } from '../ui';
import {
  formatGeneratedDate,
  formatRelativeTime,
  topicCity,
  topicClusterLabel,
  topicCountry,
  topicDifficulty,
  topicIntent,
  topicKeyword,
  topicPriority,
  topicSearchVolume,
} from './topicMeta';

function scoreTone(score: number): string {
  if (score >= 75) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-slate-400 dark:text-slate-500';
}

function CompactSeoBadge({
  score,
  volume,
  difficulty,
}: {
  score: number;
  volume: number | null;
  difficulty: number | null;
}) {
  const parts = [`SEO ${score}`];
  if (volume != null) parts.push(`Vol ${Math.round(volume)}`);
  if (difficulty != null) parts.push(`KD ${Math.round(difficulty)}`);
  return (
    <span
      className="inline-flex items-center rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-teal-700 ring-1 ring-inset ring-teal-200/80 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/20"
      title={parts.join(' · ')}
    >
      {parts.join(' · ')}
    </span>
  );
}

function OverflowBadges({
  items,
  max = 4,
}: {
  items: Array<{ key: string; node: ReactNode; tip?: string }>;
  max?: number;
}) {
  const visible = items.slice(0, max);
  const rest = items.slice(max);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((item) => (
        <span key={item.key} title={item.tip}>
          {item.node}
        </span>
      ))}
      {rest.length > 0 && (
        <span
          className="inline-flex cursor-default items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-inset ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/10"
          title={rest.map((r) => r.tip || r.key).join(', ')}
        >
          +{rest.length}
        </span>
      )}
    </div>
  );
}

function MenuItem({
  label,
  icon,
  onClick,
  danger,
  disabled,
}: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10'
          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.06]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export const TopicCard = memo(function TopicCard({
  topic,
  clusterMap,
  selected,
  busy,
  onToggle,
  onPreview,
  onApprove,
  onReject,
  onSchedule,
  onDelete,
  onCopyKeyword,
  onShiftClick,
  onContext,
}: {
  topic: Topic;
  clusterMap: Map<number, Cluster>;
  selected: boolean;
  busy: boolean;
  onToggle: (id: number, checked: boolean) => void;
  onPreview: (topic: Topic) => void;
  onApprove: (topic: Topic) => void;
  onReject: (topic: Topic) => void;
  onSchedule: (topic: Topic) => void;
  onDelete: (topic: Topic) => void;
  onCopyKeyword: (topic: Topic) => void;
  onShiftClick: (id: number) => void;
  onContext: (topic: Topic, x: number, y: number) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const keyword = topicKeyword(topic);
  const country = topicCountry(topic);
  const city = topicCity(topic);
  const intent = topicIntent(topic);
  const priority = topicPriority(topic);
  const cluster = topicClusterLabel(topic, clusterMap);
  const difficulty = topicDifficulty(topic);
  const volume = topicSearchVolume(topic);
  const canApprove = topic.status === 'candidate';
  const canReject = !topic.locked && !['published', 'rejected'].includes(topic.status);
  const canSchedule = ['candidate', 'approved'].includes(topic.status);
  const canDelete = !topic.locked && !['published'].includes(topic.status);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const extraBadges: Array<{ key: string; node: ReactNode; tip?: string }> = [];
  if (city) {
    extraBadges.push({
      key: 'city',
      tip: `City: ${city}`,
      node: (
        <Badge tone="indigo" className="!rounded-md !px-1.5 !py-0.5 !text-[10px]">
          {city}
        </Badge>
      ),
    });
  }
  if (cluster) {
    extraBadges.push({
      key: 'cluster',
      tip: `Cluster: ${cluster}`,
      node: (
        <Badge tone="indigo" className="!rounded-md !px-1.5 !py-0.5 !text-[10px]">
          {cluster}
        </Badge>
      ),
    });
  }
  if (intent) {
    extraBadges.push({
      key: 'intent',
      tip: `Intent: ${intent.replace(/_/g, ' ')}`,
      node: (
        <Badge tone="neutral" className="!rounded-md !px-1.5 !py-0.5 !text-[10px]">
          {intent.replace(/_/g, ' ')}
        </Badge>
      ),
    });
  }
  if (priority) {
    extraBadges.push({
      key: 'priority',
      tip: `Priority: ${priority}`,
      node: (
        <Badge tone="amber" className="!rounded-md !px-1.5 !py-0.5 !text-[10px]">
          {priority}
        </Badge>
      ),
    });
  }
  if (topic.locked) {
    extraBadges.push({
      key: 'locked',
      tip: 'Locked',
      node: (
        <Badge tone="amber" className="!rounded-md !px-1.5 !py-0.5 !text-[10px]">
          Locked
        </Badge>
      ),
    });
  }

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(topic, e.clientX, e.clientY);
      }}
      onDoubleClick={() => {
        if (canApprove) onApprove(topic);
      }}
    >
      <Card
        padding="p-0"
        className={`group overflow-hidden border transition-all duration-200 ${
          selected
            ? 'border-teal-400/60 shadow-md shadow-teal-500/10 ring-2 ring-teal-500/30 dark:border-teal-400/40 dark:ring-teal-400/25'
            : 'hover:border-teal-500/35 hover:shadow-md hover:shadow-slate-200/70 dark:hover:border-teal-400/25 dark:hover:shadow-black/25'
        }`}
      >
        <div className="flex gap-3 px-4 py-4 sm:gap-4 sm:px-5 sm:py-[1.125rem]">
          <div className="flex shrink-0 items-start pt-1">
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => {
                if ((e.nativeEvent as MouseEvent).shiftKey) onShiftClick(topic.id);
                else onToggle(topic.id, e.target.checked);
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 cursor-pointer rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-white/20 dark:bg-slate-900"
              aria-label={`Select ${topic.title}`}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={(e) => {
                  if ((e.nativeEvent as MouseEvent).shiftKey) {
                    onShiftClick(topic.id);
                    return;
                  }
                  onPreview(topic);
                }}
              >
                <p className="text-[15px] font-semibold leading-snug tracking-tight text-slate-900 dark:text-white">
                  {topic.title}
                </p>
                {keyword && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{keyword}</p>
                )}
              </button>

              <div className="flex shrink-0 items-center gap-1.5 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                {canApprove && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Check className="h-3.5 w-3.5" />}
                    loading={busy}
                    onClick={() => onApprove(topic)}
                  >
                    Approve
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Eye className="h-3.5 w-3.5" />}
                  onClick={() => onPreview(topic)}
                >
                  Preview
                </Button>
                <div ref={menuRef} className="relative">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="!px-2"
                    aria-label="More actions"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((v) => !v)}
                    icon={<MoreVertical className="h-4 w-4" />}
                  />
                  {menuOpen && (
                    <div className="absolute right-0 top-full z-40 mt-1 min-w-[180px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-slate-950">
                      {canSchedule && (
                        <MenuItem
                          label="Schedule"
                          icon={<Calendar className="h-3.5 w-3.5 opacity-50" />}
                          onClick={() => {
                            setMenuOpen(false);
                            onSchedule(topic);
                          }}
                        />
                      )}
                      {canReject && (
                        <MenuItem
                          label="Reject"
                          icon={<X className="h-3.5 w-3.5 opacity-50" />}
                          onClick={() => {
                            setMenuOpen(false);
                            onReject(topic);
                          }}
                        />
                      )}
                      {keyword && (
                        <MenuItem
                          label="Copy Keyword"
                          icon={<Copy className="h-3.5 w-3.5 opacity-50" />}
                          onClick={() => {
                            setMenuOpen(false);
                            onCopyKeyword(topic);
                          }}
                        />
                      )}
                      <MenuItem
                        label="Open Research"
                        icon={<FlaskConical className="h-3.5 w-3.5 opacity-50" />}
                        onClick={() => {
                          setMenuOpen(false);
                          onPreview(topic);
                        }}
                      />
                      {canDelete && (
                        <MenuItem
                          label="Delete"
                          danger
                          icon={<Trash2 className="h-3.5 w-3.5 opacity-50" />}
                          onClick={() => {
                            setMenuOpen(false);
                            onDelete(topic);
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              {country && <span className="font-medium text-slate-600 dark:text-slate-300">{country}</span>}
              {country && <span className="text-slate-300 dark:text-slate-600">·</span>}
              <span className="capitalize">{topic.content_type.replace(/_/g, ' ')}</span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <StatusPill status={topic.status} />
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className={`font-bold tabular-nums ${scoreTone(topic.priority_score)}`}>
                {topic.priority_score}
              </span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <CompactSeoBadge
                score={topic.priority_score}
                volume={volume}
                difficulty={difficulty}
              />
              <OverflowBadges items={extraBadges} max={3} />
            </div>

            <p className="mt-2.5 text-[11px] text-slate-400 dark:text-slate-500">
              Generated {formatGeneratedDate(topic.created_at)} · {formatRelativeTime(topic.created_at)}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
});
