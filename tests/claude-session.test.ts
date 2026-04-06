import { describe, it, expect } from 'vitest'
import { ClaudeSession } from '../src/claude-session.js'

describe('ClaudeSession', () => {
  it('constructs with correct default options', () => {
    const session = new ClaudeSession({
      workspaceDir: '/tmp/test',
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
    })
    expect(session.isAlive()).toBe(false)
    expect(session.sessionId).toBeUndefined()
  })

  it('builds correct spawn arguments', () => {
    const session = new ClaudeSession({
      workspaceDir: '/tmp/test',
      model: 'opus',
      permissionMode: 'default',
      effort: 'max',
      appendSystemPrompt: 'You are JARVIS.',
      maxBudgetUsd: 5,
    })
    const args = session.buildSpawnArgs()
    expect(args).toContain('-p')
    expect(args).toContain('--input-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--output-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--model')
    expect(args).toContain('opus')
    expect(args).toContain('--permission-mode')
    expect(args).toContain('default')
    expect(args).toContain('--effort')
    expect(args).toContain('max')
    expect(args).toContain('--append-system-prompt')
    expect(args).toContain('You are JARVIS.')
    expect(args).toContain('--max-budget-usd')
    expect(args).toContain('5')
    expect(args).toContain('--include-partial-messages')
    expect(args).toContain('--verbose')
  })

  it('includes --resume when sessionId is set', () => {
    const session = new ClaudeSession({
      workspaceDir: '/tmp/test',
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
      resumeSessionId: 'abc-123',
    })
    const args = session.buildSpawnArgs()
    expect(args).toContain('--resume')
    expect(args).toContain('abc-123')
  })

  it('parses assistant event from NDJSON line', () => {
    const session = new ClaudeSession({
      workspaceDir: '/tmp/test',
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
    })
    const event = session.parseLine('{"type":"assistant","message":"Hello world"}')
    expect(event).toEqual({ type: 'assistant', message: 'Hello world' })
  })

  it('returns null for unparseable lines', () => {
    const session = new ClaudeSession({
      workspaceDir: '/tmp/test',
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
    })
    expect(session.parseLine('not json')).toBeNull()
    expect(session.parseLine('')).toBeNull()
  })
})
