/**
 * The goal tree as the factory draws it: one S-expression head per goal,
 * `( type ⟨title⟩ … ⇒ result )`, nested by depth, skinned by state. Built on
 * react-aria's Tree for keyboard navigation, expansion, and selection.
 */

import { useMemo, useState } from 'react';
import { Button, Collection, Tree, TreeItem, TreeItemContent, type Key } from 'react-aria-components';

import type { GoalTreeNode } from '../factory';
import { usd } from '../lib/format';

interface Item {
  id: string;
  node: GoalTreeNode;
  children: Item[];
}

const toItem = (node: GoalTreeNode): Item => ({ id: node.goalId, node, children: node.children.map(toItem) });

export interface GoalTreeProps {
  root: GoalTreeNode;
  spendByGoal: Record<string, number | undefined>;
  selected: string | undefined;
  onSelect(goalId: string | undefined): void;
}

export function GoalTree({ root, spendByGoal, selected, onSelect }: GoalTreeProps) {
  const items = useMemo(() => [toItem(root)], [root]);
  const [collapsed, setCollapsed] = useState<Set<Key>>(new Set());
  const expanded = useMemo(() => {
    const keys = new Set<Key>();
    const walk = (it: Item) => {
      if (it.children.length && !collapsed.has(it.id)) keys.add(it.id);
      it.children.forEach(walk);
    };
    items.forEach(walk);
    return keys;
  }, [items, collapsed]);

  const renderItem = (item: Item) => (
    <TreeItem
      id={item.id}
      textValue={item.node.title}
      className="form-row"
      style={({ level }) => ({ '--level': level }) as React.CSSProperties}
    >
      <TreeItemContent>
        {({ hasChildItems, isExpanded }) => <Head node={item.node} spend={spendByGoal[item.id]} fold={hasChildItems ? (isExpanded ? '▾' : '▸') : null} />}
      </TreeItemContent>
      <Collection items={item.children}>{renderItem}</Collection>
    </TreeItem>
  );

  return (
    <Tree
      aria-label="Goal tree"
      className="sexpr"
      items={items}
      selectionMode="single"
      selectedKeys={selected ? [selected] : []}
      onSelectionChange={(keys) => {
        const [first] = keys === 'all' ? [] : [...keys];
        onSelect(first === undefined ? undefined : String(first));
      }}
      expandedKeys={expanded}
      onExpandedChange={(next) => {
        const all = new Set<Key>();
        const walk = (it: Item) => {
          if (it.children.length) all.add(it.id);
          it.children.forEach(walk);
        };
        items.forEach(walk);
        setCollapsed(new Set([...all].filter((k) => !next.has(k))));
      }}
    >
      {renderItem}
    </Tree>
  );
}

function Head({ node, spend, fold }: { node: GoalTreeNode; spend: number | undefined; fold: string | null }) {
  return (
    <div className="head" data-state={node.state}>
      <span className="fold">{fold ? <Button slot="chevron" aria-label="Fold">{fold}</Button> : null}</span>
      <span className="paren">(</span>
      <span className="gtype">{node.goalType}</span>
      <span className="goal-title">{node.title}</span>
      {node.state === 'parked' ? <span className="tag !border-teal !text-teal">awaiting operator</span> : null}
      {node.state === 'running' ? <span className="tag !border-brass !text-brass-deep">live</span> : null}
      <Result node={node} spend={spend} />
      <span className="paren">)</span>
    </div>
  );
}

function Result({ node, spend }: { node: GoalTreeNode; spend: number | undefined }) {
  if (node.state !== 'done' && node.state !== 'failed' && node.state !== 'blocked') {
    return spend ? <span className="ret !text-ink-soft">{usd(spend)}</span> : null;
  }
  const ok = node.state === 'done';
  return (
    <span className={`ret ${ok ? '' : '!text-oxblood'}`}>
      <span className="arrow">⇒</span> {ok ? '✓' : '✗'}
      {spend ? ` ${usd(spend)}` : ''}
    </span>
  );
}
