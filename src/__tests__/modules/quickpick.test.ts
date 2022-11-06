import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import { QuickPickItem } from '../../types'
import { disposeAll } from '../../util'
import events from '../../events'
import window from '../../window'
import QuickPick from '../../model/quickpick'
import helper from '../helper'
export type Item = QuickPickItem | string

let nvim: Neovim
let disposables: Disposable[] = []

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})
afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

async function getTitleLine(): Promise<string> {
  let winids = await nvim.call('coc#float#get_float_win_list') as number[]
  let winid = Math.min(...winids)
  let id = await nvim.call('coc#float#get_related', [winid, 'border']) as number
  let win = nvim.createWindow(id)
  let buf = await win.buffer
  let lines = await buf.lines
  return lines[0]
}

describe('QuickPick', () => {
  it('should not thrown when window not shown', async () => {
    let q = new QuickPick(nvim)
    q.items = undefined
    expect(q.winid).toBeUndefined()
    expect(q.activeItems).toEqual([])
    q.title = 'title'
    expect(q.title).toBe('title')
    q.loading = true
    expect(q.loading).toBe(true)
    q.value = 'value'
    expect(q.value).toBe('value')
    expect(q.buffer).toBeUndefined()
    expect(q.currIndex).toBe(0)
    q.setCursor(0)
    q.filterItems('a')
    q.showFilteredItems()
    q.toggePicked(0)
    q.dispose()
  })

  it('should show picker items on filter', async () => {
    let q = new QuickPick(nvim, {})
    q.items = [{
      label: 'foo',
      picked: true
    }, {
      label: 'bar',
      picked: true
    }, {
      label: 'asdf',
      picked: false
    }]
    q.canSelectMany = true
    await q.show()
    await nvim.input('f')
    await helper.waitValue(() => {
      return q.activeItems.length
    }, 2)
    expect(q.value).toBe('f')
    expect(q.selectedItems.length).toBe(2)
    await nvim.input('<C-space>')
    await helper.waitValue(() => {
      return q.selectedItems.length
    }, 1)
    q.showFilteredItems()
    q.dispose()
  })
})

describe('showQuickPick', () => {
  async function testQuickPick(items: Item[], canPickMany: boolean, cancel: boolean, res: any) {
    let p = window.showQuickPick(items, { canPickMany })
    await helper.waitFloat()
    await nvim.input('b')
    await nvim.input('<C-space>')
    await helper.wait(50)
    if (cancel) {
      await nvim.input('<esc>')
    } else {
      await nvim.input('<cr>')
    }
    let result = await p
    if (res == null) {
      expect(result).toBe(res)
    } else {
      expect(res).toEqual(res)
    }
  }

  it('should resolve for empty list', async () => {
    let res = await window.showQuickPick([], { title: 'title' })
    expect(res).toBeUndefined()
  })

  it('should resolve undefined when token cancelled', async () => {
    let tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    tokenSource.cancel()
    let res = await window.showQuickPick(['foo', 'bar'], undefined, token)
    expect(res).toBeUndefined()
    let release = await window.mutex.acquire()
    tokenSource = new CancellationTokenSource()
    token = tokenSource.token
    let p = window.showQuickPick(['foo', 'bar'], undefined, token)
    tokenSource.cancel()
    release()
    res = await p
    expect(res).toBeUndefined()
  })

  it('should show quickfix with items or texts', async () => {
    await testQuickPick(['foo', 'bar'], false, false, 'bar')
    await testQuickPick(['foo', 'bar'], true, false, ['bar'])
    await testQuickPick(['foo', 'bar'], false, true, undefined)
    let items: QuickPickItem[] = [{ label: 'foo', description: 'desc' }, { label: 'bar', picked: true }]
    await testQuickPick(items, false, false, { label: 'bar', picked: true })
    await testQuickPick(items, true, false, [{ label: 'bar', picked: true }])
  })

  it('should use title option', async () => {
    let p = window.showQuickPick(['foo', 'bar'], { title: 'title' })
    await helper.waitFloat()
    let line = await getTitleLine()
    expect(line).toMatch('title')
    await nvim.input('<esc>')
    await p
  })

  it('should match on description', async () => {
    let items: QuickPickItem[] = [{ label: 'foo', description: 'desc' }, { label: 'bar', picked: true }]
    let p = window.showQuickPick(items, { matchOnDescription: true })
    await helper.waitFloat()
    await nvim.input('d')
    await helper.wait(10)
    await nvim.input('<cr>')
    let res = await p
    expect(res).toBeDefined()
  })
})

describe('createQuickPick', () => {
  it('should throw when unable to open input window', async () => {
    let fn = nvim.call
    nvim.call = (...args: any) => {
      if (args[0] === 'coc#dialog#create_prompt_win') return undefined
      return fn.apply(nvim, args)
    }
    disposables.push(Disposable.create(() => {
      nvim.call = fn
    }))
    let fun = async () => {
      let quickpick = await window.createQuickPick({
        items: [{ label: 'foo' }, { label: 'bar' }],
      })
      await quickpick.show()
    }
    await expect(fun()).rejects.toThrow(/Unable to open/)
  })

  it('should throw when unable to open list window', async () => {
    let fn = nvim.call
    nvim.call = (...args: any) => {
      if (args[0] === 'coc#dialog#create_list') return undefined
      return fn.apply(nvim, args)
    }
    disposables.push(Disposable.create(() => {
      nvim.call = fn
    }))
    let fun = async () => {
      let quickpick = await window.createQuickPick({
        items: [{ label: 'foo' }, { label: 'bar' }],
      })
      await quickpick.show()
    }
    await expect(fun()).rejects.toThrow(/Unable to open/)
  })

  it('should respect initial value', async () => {
    let q = await window.createQuickPick()
    q.items = [{ label: 'foo' }, { label: 'bar' }]
    q.value = 'value'
    await q.show()
    let winids = await nvim.call('coc#float#get_float_win_list') as number[]
    let winid = Math.min(...winids)
    let buf = await (nvim.createWindow(winid)).buffer
    let lines = await buf.lines
    expect(lines[0]).toBe('value')
    await nvim.input('<esc>')
  })

  it('should respect width of quickpick', async () => {
    helper.updateConfiguration('dialog.maxWidth', null)
    let q = await window.createQuickPick()
    q.items = [{ label: 'foo' }, { label: 'bar' }]
    q.width = 50
    q.value = ''
    await q.show()
    let win = nvim.createWindow(q.winid)
    let width = await win.width
    expect(width).toBe(50)
  })

  it('should scroll by <C-f> and <C-b>', async () => {
    helper.updateConfiguration('dialog.maxHeight', 2)
    let quickpick = await window.createQuickPick()
    quickpick.value = ''
    quickpick.items = [{ label: 'one' }, { label: 'two' }, { label: 'three' }]
    await quickpick.show()
    disposables.push(quickpick)
    let winid = quickpick.winid
    await nvim.input('<C-f>')
    await helper.wait(1)
    await nvim.input('<C-f>')
    await helper.waitValue(async () => {
      let info = await nvim.call('getwininfo', [winid])
      return info[0].topline
    }, 2)
    await nvim.input('<C-b>')
    await nvim.input('<C-x>')
    await helper.wait(1)
    await nvim.input('<C-b>')
    await helper.waitValue(async () => {
      let info = await nvim.call('getwininfo', [winid])
      return info[0].topline
    }, 1)
  })

  it('should change current line by <C-j> and <C-k>', async () => {
    let quickpick = await window.createQuickPick()
    quickpick.items = [{ label: 'one' }, { label: 'two' }, { label: 'three' }]
    await quickpick.show()
    disposables.push(quickpick)
    await nvim.input('<C-j>')
    await helper.wait(1)
    await nvim.input('<C-j>')
    await helper.waitValue(() => {
      return quickpick.currIndex
    }, 2)
    await nvim.input('<C-k>')
    await helper.wait(1)
    await nvim.input('<C-k>')
    await helper.waitValue(() => {
      return quickpick.currIndex
    }, 0)
  })

  it('should toggle selected item by <C-space>', async () => {
    let quickpick = await window.createQuickPick()
    quickpick.items = [{ label: 'one' }, { label: 'two' }, { label: 'three' }]
    disposables.push(quickpick)
    await nvim.input('<C-sapce>')
    await helper.wait(10)
    await nvim.input('<C-k>')
    await helper.wait(10)
    await nvim.input('<C-sapce>')
    await helper.waitValue(() => {
      return quickpick.selectedItems.length
    }, 0)
  })

  it('should not handle events from other buffer', async () => {
    let quickpick = await window.createQuickPick({
      items: [{ label: 'one' }, { label: 'two' }, { label: 'three' }],
    })
    await quickpick.show()
    disposables.push(quickpick)
    await events.fire('BufWinLeave', [quickpick.buffer.id + 1])
    await events.fire('PromptKeyPress', [quickpick.buffer.id + 1, 'C-f'])
    expect(quickpick.currIndex).toBe(0)
  })

  it('should respect configurations', async () => {
    helper.updateConfiguration('dialog.maxWidth', 30)
    helper.updateConfiguration('dialog.rounded', false)
    helper.updateConfiguration('dialog.floatHighlight', 'Normal')
    helper.updateConfiguration('dialog.floatBorderHighlight', 'Normal')
    helper.updateConfiguration('dialog.maxHeight', 2)
    let quickpick = await window.createQuickPick()
    quickpick.items = [{ label: 'one' }, { label: 'two' }, { label: 'three' }]
    await quickpick.show()
    let winids = await nvim.call('coc#float#get_float_win_list') as number[]
    let winid = Math.max(...winids)
    let win = nvim.createWindow(winid)
    let h = await win.height
    expect(h).toBe(2)
    await nvim.input('<esc>')
  })

  it('should change title', async () => {
    let quickpick = await window.createQuickPick()
    quickpick.items = [{ label: 'one' }, { label: 'two' }]
    quickpick.title = 'from'
    disposables.push(quickpick)
    quickpick.title = 'to'
    expect(quickpick.title).toBe('to')
    await quickpick.show()
    let line = await getTitleLine()
    expect(line).toMatch(/to/)
  })

  it('should change loading', async () => {
    let quickpick = await window.createQuickPick()
    quickpick.items = [{ label: 'one' }, { label: 'two' }]
    disposables.push(quickpick)
    await quickpick.show()
    quickpick.loading = true
    expect(quickpick.loading).toBe(true)
    quickpick.loading = false
    expect(quickpick.loading).toBe(false)
  })

  it('should change items', async () => {
    let quickpick = await window.createQuickPick()
    quickpick.items = [{ label: 'one' }, { label: 'two' }]
    await quickpick.show()
    disposables.push(quickpick)
    quickpick.onDidChangeValue(val => {
      if (val == '>') {
        quickpick.items = [{ label: 'three' }]
      }
    })
    await nvim.input('>')
    await helper.waitValue(async () => {
      let lines = await quickpick.buffer.lines
      return lines
    }, ['three'])
  })

  it('should change activeItems', async () => {
    let quickpick = await window.createQuickPick<QuickPickItem>()
    quickpick.items = [{ label: 'one' }]
    disposables.push(quickpick)
    await quickpick.show()
    quickpick.onDidChangeValue(val => {
      if (val == 'f') {
        quickpick.activeItems = [{ label: 'foo', description: 'description' }, { label: 'foot' }, { label: 'bar' }]
      }
    })
    await nvim.input('f')
    await helper.waitValue(async () => {
      let lines = await quickpick.buffer.lines
      return lines
    }, ['foo description', 'foot', 'bar'])
  })
})
