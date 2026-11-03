import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { UpdatePanel } from './UpdatePanel';
import type { UpdatePanelProps } from './UpdatePanel';
import type { UpdateState } from '../shared/updates';

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: vi.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, vi.fn()]),
  useEffect: vi.fn(),
}));

function makeState(overrides: Partial<UpdateState> = {}): UpdateState {
  return {
    revision: 1,
    currentVersion: '0.2.5',
    currentChannel: 'stable',
    selectedChannel: 'stable',
    intent: 'upgrade',
    phase: 'idle',
    busy: false,
    step: 'idle',
    downloaded: 0,
    total: null,
    release: null,
    lastBackup: null,
    history: [],
    updatedAt: 1000,
    error: null,
    ...overrides,
  };
}

function makeProps(overrides: Partial<UpdatePanelProps> = {}): UpdatePanelProps {
  return {
    state: makeState(),
    connectionError: null,
    onCheck: vi.fn(),
    onJoinBeta: vi.fn(),
    onLeaveBeta: vi.fn(),
    onCheckStableTarget: vi.fn(),
    onDismissTarget: vi.fn(),
    onDownload: vi.fn(),
    onInstall: vi.fn(),
    onReconnect: vi.fn(),
    ...overrides,
  };
}

function walk(node: ReactNode, visit: (el: ReactElement<Record<string, unknown>>) => void): void {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach(child => walk(child, visit));
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === 'function') {
    walk((el.type as (props: Record<string, unknown>) => ReactNode)(el.props), visit);
    return;
  }
  visit(el);
  walk(el.props.children as ReactNode, visit);
}

it('shows current build, stable channel, Join Beta entry, and manual GitHub overwrite help by default', () => {
  const html = renderToStaticMarkup(createElement(UpdatePanel, makeProps()));
  expect(html).toContain('当前构建：<strong>v0.2.5</strong>（稳定版构建）');
  expect(html).toContain('当前更新渠道：<strong>稳定版渠道</strong>');
  expect(html).toContain('加入 Beta 体验');
  expect(html).toContain('旧版本无入口或从 GitHub 手动覆盖安装说明');
  expect(html).toContain('请勿卸载');
});

it('displays Join Beta confirmation with data preservation and backup notice and confirms or cancels', async () => {
  const { useState } = await import('react');
  const setConfirming = vi.fn(), setExited = vi.fn();
  vi.mocked(useState)
    .mockReturnValueOnce([1000, vi.fn()])
    .mockReturnValueOnce([true, setConfirming])
    .mockReturnValueOnce([false, setExited]);

  const onJoinBeta = vi.fn();
  const props = makeProps({ onJoinBeta });
  const html = renderToStaticMarkup(createElement(UpdatePanel, props));
  expect(html).toContain('确认加入 Beta 体验？');
  expect(html).toContain('无需账号申请或提交个人信息');
  expect(html).toContain('保留当前全部业务数据与设置');
  expect(html).toContain('建立且校验完整数据备份');

  vi.mocked(useState)
    .mockReturnValueOnce([1000, vi.fn()])
    .mockReturnValueOnce([true, setConfirming])
    .mockReturnValueOnce([false, setExited]);
  const buttons: Record<string, () => void> = {};
  walk(createElement(UpdatePanel, props), el => {
    if (el.type === 'button' && typeof el.props.children === 'string') {
      buttons[el.props.children] = el.props.onClick as () => void;
    }
  });
  buttons['取消']();
  expect(setConfirming).toHaveBeenCalledWith(false);
  expect(onJoinBeta).not.toHaveBeenCalled();

  buttons['确认加入 Beta']();
  expect(onJoinBeta).toHaveBeenCalledOnce();
});

it('shows Leave Beta when enrolled and presents stay vs install stable options when on a beta build tracking stable', () => {
  const betaEnrolledHtml = renderToStaticMarkup(
    createElement(
      UpdatePanel,
      makeProps({
        state: makeState({
          currentVersion: '0.3.0-beta.1',
          currentChannel: 'beta',
          selectedChannel: 'beta',
        }),
      }),
    ),
  );
  expect(betaEnrolledHtml).toContain('当前构建：<strong>v0.3.0-beta.1</strong>（Beta 测试构建）');
  expect(betaEnrolledHtml).toContain('当前更新渠道：<strong>已加入 Beta 体验</strong>');
  expect(betaEnrolledHtml).toContain('退出 Beta');

  // After exiting Beta while still running a Beta build (0.3.0-beta.1 + selectedChannel=stable):
  const exitedHtml = renderToStaticMarkup(
    createElement(
      UpdatePanel,
      makeProps({
        state: makeState({
          currentVersion: '0.3.0-beta.1',
          currentChannel: 'beta',
          selectedChannel: 'stable',
        }),
      }),
    ),
  );
  expect(exitedHtml).toContain('当前运行 Beta 构建（v0.3.0-beta.1），更新渠道为稳定版');
  expect(exitedHtml).toContain('留在当前版本，等待后续稳定更新');
  expect(exitedHtml).toContain('安装稳定版');
  expect(exitedHtml).toContain('不会自动还原历史备份');
});

it('renders explicit stable downgrade target confirmation with compatibility, backup explanation, and blocks incompatible targets', () => {
  const compatibleHtml = renderToStaticMarkup(
    createElement(
      UpdatePanel,
      makeProps({
        state: makeState({
          currentVersion: '0.3.0-beta.1',
          currentChannel: 'beta',
          selectedChannel: 'stable',
          intent: 'returnToStable',
          phase: 'available',
          step: 'available',
          release: {
            version: '0.2.5',
            notes: '0.2.5 正式版说明',
            tag: 'v0.2.5',
            releaseId: 430648033,
            channel: 'stable',
            isDowngrade: true,
            compatibility: {
              compatible: true,
              source: 'auditedTable',
              dataSchemaVersion: 2,
              readableDataSchemaVersions: [2],
              reason: '已通过源码与实测兼容核验（schema v2）',
            },
          },
        }),
      }),
    ),
  );
  expect(compatibleHtml).toContain('目标稳定版本：<strong>v0.2.5</strong>（v0.2.5）');
  expect(compatibleHtml).toContain('属于版本回退（从 v0.3.0-beta.1 回退覆盖至稳定版 v0.2.5）');
  expect(compatibleHtml).toContain('已核验兼容（保留当前数据）');
  expect(compatibleHtml).toContain('确认下载稳定版 v0.2.5');
  expect(compatibleHtml).toContain('留在当前版本');

  // Incompatible legacy target must not render download or install button
  const incompatibleHtml = renderToStaticMarkup(
    createElement(
      UpdatePanel,
      makeProps({
        state: makeState({
          currentVersion: '0.3.0-beta.1',
          currentChannel: 'beta',
          selectedChannel: 'stable',
          intent: 'returnToStable',
          phase: 'idle',
          step: 'manifest',
          release: {
            version: '0.2.4',
            notes: null,
            tag: 'v0.2.4',
            channel: 'stable',
            isDowngrade: true,
            compatibility: {
              compatible: false,
              source: 'unverifiedLegacy',
              dataSchemaVersion: null,
              readableDataSchemaVersions: [],
              reason: '历史版本 v0.2.4 缺少数据兼容声明',
            },
          },
          error: { message: '历史版本 v0.2.4 缺少数据兼容声明', step: 'manifest', at: 2000 },
        }),
      }),
    ),
  );
  expect(incompatibleHtml).toContain('不兼容（已阻断覆盖）');
  expect(incompatibleHtml).not.toContain('确认下载稳定版');
  expect(incompatibleHtml).not.toContain('确认重启并安装稳定版');
});

it('disables channel switching and explains active step when update operation is busy', () => {
  const busyHtml = renderToStaticMarkup(
    createElement(
      UpdatePanel,
      makeProps({
        state: makeState({
          phase: 'preparing',
          busy: true,
          step: 'backup',
        }),
      }),
    ),
  );
  expect(busyHtml).toContain('当前正在执行「安装准备中 · 建立并校验安装前数据备份」，操作完成前暂不能切换更新渠道。');
});
