import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const SIZES = [16, 24, 32, 48, 64, 96]
const DEFAULT_SIZE = 32
const TRANSPARENT = 'transparent'
const STARTING_COLOR = '#25324d'
const STARTING_PALETTE = [
  '#25324d',
  '#f04f78',
  '#ffb84d',
  '#ffe66d',
  '#51c878',
  '#3ba7ff',
  '#9c6bff',
  '#ffffff',
]

function createPixels(size) {
  return Array.from({ length: size * size }, () => TRANSPARENT)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function pixelsEqual(first, second) {
  return first.length === second.length && first.every((pixel, index) => pixel === second[index])
}

function lineIndexes(fromIndex, toIndex, size) {
  const points = []
  let x = fromIndex % size
  let y = Math.floor(fromIndex / size)
  const endX = toIndex % size
  const endY = Math.floor(toIndex / size)
  const stepX = x < endX ? 1 : -1
  const stepY = y < endY ? 1 : -1
  const deltaX = Math.abs(endX - x)
  const deltaY = -Math.abs(endY - y)
  let error = deltaX + deltaY

  while (true) {
    points.push(y * size + x)
    if (x === endX && y === endY) break

    const nextError = 2 * error
    if (nextError >= deltaY) {
      error += deltaY
      x += stepX
    }
    if (nextError <= deltaX) {
      error += deltaX
      y += stepY
    }
  }

  return points
}

function pointToPixelIndex(clientX, clientY, element, size) {
  const rect = element.getBoundingClientRect()
  const x = clamp(Math.floor(((clientX - rect.left) / rect.width) * size), 0, size - 1)
  const y = clamp(Math.floor(((clientY - rect.top) / rect.height) * size), 0, size - 1)

  return y * size + x
}

function App() {
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [pixels, setPixels] = useState(() => createPixels(DEFAULT_SIZE))
  const pixelsRef = useRef(pixels)
  const strokeStartRef = useRef(null)
  const lastPaintIndexRef = useRef(null)
  const activePointerIdRef = useRef(null)
  const isDrawingRef = useRef(false)
  const [history, setHistory] = useState([])
  const [future, setFuture] = useState([])
  const [tool, setTool] = useState('pencil')
  const [color, setColor] = useState(STARTING_COLOR)
  const [colorDraft, setColorDraft] = useState(STARTING_COLOR)
  const [recentColors, setRecentColors] = useState([STARTING_COLOR])
  const [palette, setPalette] = useState(STARTING_PALETTE)
  const [brushSize, setBrushSize] = useState(1)
  const [showGrid, setShowGrid] = useState(true)
  const [mirrorX, setMirrorX] = useState(false)
  const [mirrorY, setMirrorY] = useState(false)

  const filledCount = useMemo(
    () => pixels.filter((pixel) => pixel !== TRANSPARENT).length,
    [pixels],
  )

  const finishStroke = useCallback(() => {
    activePointerIdRef.current = null
    isDrawingRef.current = false

    if (!strokeStartRef.current) return

    const startPixels = strokeStartRef.current
    const currentPixels = pixelsRef.current
    strokeStartRef.current = null
    lastPaintIndexRef.current = null

    if (pixelsEqual(startPixels, currentPixels)) return

    setHistory((items) => [...items.slice(-39), startPixels])
    setFuture([])
  }, [])

  useEffect(() => {
    pixelsRef.current = pixels
  }, [pixels])

  useEffect(() => {
    const stopDrawing = () => finishStroke()
    window.addEventListener('pointerup', stopDrawing)
    window.addEventListener('pointercancel', stopDrawing)
    return () => {
      window.removeEventListener('pointerup', stopDrawing)
      window.removeEventListener('pointercancel', stopDrawing)
    }
  }, [finishStroke])

  function remember(nextPixels) {
    setPixels((current) => {
      if (current === nextPixels || pixelsEqual(current, nextPixels)) {
        return current
      }
      pixelsRef.current = nextPixels
      setHistory((items) => [...items.slice(-39), current])
      setFuture([])
      return nextPixels
    })
  }

  function chooseColor(nextColor) {
    setColor(nextColor)
    setColorDraft(nextColor)
    setRecentColors((items) => [nextColor, ...items.filter((item) => item !== nextColor)].slice(0, 4))
  }

  function handleHexColorChange(value) {
    const normalized = value.startsWith('#') ? value : `#${value}`
    setColorDraft(normalized)
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      chooseColor(normalized)
    }
  }

  function mirroredPoints(x, y) {
    const points = new Map()
    const add = (nextX, nextY) => {
      points.set(`${nextX}:${nextY}`, { x: nextX, y: nextY })
    }

    add(x, y)
    if (mirrorX) add(size - 1 - x, y)
    if (mirrorY) add(x, size - 1 - y)
    if (mirrorX && mirrorY) add(size - 1 - x, size - 1 - y)

    return [...points.values()]
  }

  function brushPoints(x, y) {
    const radius = Math.floor(brushSize / 2)
    const points = new Map()

    for (const center of mirroredPoints(x, y)) {
      for (let offsetY = 0; offsetY < brushSize; offsetY += 1) {
        for (let offsetX = 0; offsetX < brushSize; offsetX += 1) {
          const nextX = clamp(center.x + offsetX - radius, 0, size - 1)
          const nextY = clamp(center.y + offsetY - radius, 0, size - 1)
          points.set(`${nextX}:${nextY}`, nextY * size + nextX)
        }
      }
    }

    return [...points.values()]
  }

  function paintOnPixels(sourcePixels, index, forceTool = tool) {
    const x = index % size
    const y = Math.floor(index / size)
    const nextColor = forceTool === 'eraser' ? TRANSPARENT : color
    const nextPixels = [...sourcePixels]

    for (const pixelIndex of brushPoints(x, y)) {
      nextPixels[pixelIndex] = nextColor
    }

    return nextPixels
  }

  function drawAt(index, forceTool = tool) {
    const x = index % size
    const y = Math.floor(index / size)
    const currentPixels = pixelsRef.current

    if (forceTool === 'picker') {
      const picked = currentPixels[index]
      if (picked !== TRANSPARENT) chooseColor(picked)
      setTool('pencil')
      return
    }

    if (forceTool === 'fill') {
      fillAt(x, y)
      return
    }

    remember(paintOnPixels(currentPixels, index, forceTool))
  }

  function fillAt(startX, startY) {
    const nextPixels = [...pixels]
    const replacement = color
    const seeds = mirroredPoints(startX, startY)
    let changed = false

    for (const seed of seeds) {
      const seedIndex = seed.y * size + seed.x
      const target = nextPixels[seedIndex]
      if (target === replacement) continue

      const queue = [seed]
      const visited = new Set()

      while (queue.length) {
        const point = queue.pop()
        const key = `${point.x}:${point.y}`
        const index = point.y * size + point.x
        if (visited.has(key) || nextPixels[index] !== target) continue

        visited.add(key)
        nextPixels[index] = replacement
        changed = true

        if (point.x > 0) queue.push({ x: point.x - 1, y: point.y })
        if (point.x < size - 1) queue.push({ x: point.x + 1, y: point.y })
        if (point.y > 0) queue.push({ x: point.x, y: point.y - 1 })
        if (point.y < size - 1) queue.push({ x: point.x, y: point.y + 1 })
      }
    }

    if (changed) remember(nextPixels)
  }

  function handleCanvasPointerDown(event) {
    if (activePointerIdRef.current !== null) return

    event.preventDefault()
    const index = pointToPixelIndex(event.clientX, event.clientY, event.currentTarget, size)

    if (tool === 'fill' || tool === 'picker') {
      drawAt(index)
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    activePointerIdRef.current = event.pointerId
    isDrawingRef.current = true
    strokeStartRef.current = pixelsRef.current
    paintStrokeAt(index)
  }

  function handleCanvasPointerMove(event) {
    if (!isDrawingRef.current || activePointerIdRef.current !== event.pointerId || tool === 'fill' || tool === 'picker') return

    event.preventDefault()

    const events =
      typeof event.nativeEvent.getCoalescedEvents === 'function'
        ? event.nativeEvent.getCoalescedEvents()
        : [event.nativeEvent]

    for (const pointerEvent of events) {
      paintStrokeAt(pointToPixelIndex(pointerEvent.clientX, pointerEvent.clientY, event.currentTarget, size))
    }
  }

  function handleCanvasPointerUp(event) {
    if (activePointerIdRef.current !== event.pointerId) return

    event.preventDefault()
    finishStroke()
  }

  function paintStrokeAt(index) {
    if (lastPaintIndexRef.current === index) return
    const indexes =
      lastPaintIndexRef.current === null
        ? [index]
        : lineIndexes(lastPaintIndexRef.current, index, size)

    setPixels((current) => {
      const nextPixels = indexes.reduce(
        (next, pixelIndex) => paintOnPixels(next, pixelIndex),
        current,
      )
      if (pixelsEqual(current, nextPixels)) return current
      pixelsRef.current = nextPixels
      return nextPixels
    })

    lastPaintIndexRef.current = index
  }

  function undo() {
    setHistory((items) => {
      if (!items.length) return items
      const previous = items.at(-1)
      setFuture((futureItems) => [pixels, ...futureItems])
      pixelsRef.current = previous
      setPixels(previous)
      return items.slice(0, -1)
    })
  }

  function redo() {
    setFuture((items) => {
      if (!items.length) return items
      const [next, ...rest] = items
      setHistory((historyItems) => [...historyItems, pixels])
      pixelsRef.current = next
      setPixels(next)
      return rest
    })
  }

  function clearCanvas() {
    remember(createPixels(size))
  }

  function resizeCanvas(nextSize) {
    const nextPixels = createPixels(nextSize)
    setSize(nextSize)
    pixelsRef.current = nextPixels
    strokeStartRef.current = null
    lastPaintIndexRef.current = null
    setPixels(nextPixels)
    setHistory([])
    setFuture([])
  }

  function addPaletteColor() {
    setPalette((items) => [color, ...items.filter((item) => item !== color)].slice(0, 12))
  }

  function removeRecentColor(colorToRemove) {
    setRecentColors((items) => items.filter((item) => item !== colorToRemove))
  }

  function removePaletteColor(colorToRemove) {
    setPalette((items) => items.filter((item) => item !== colorToRemove))
  }

  function exportPng({ transparent }) {
    const scale = 18
    const canvas = document.createElement('canvas')
    canvas.width = size * scale
    canvas.height = size * scale
    const context = canvas.getContext('2d')

    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (!transparent) {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    pixels.forEach((pixel, index) => {
      if (pixel === TRANSPARENT) return
      context.fillStyle = pixel
      context.fillRect((index % size) * scale, Math.floor(index / size) * scale, scale, scale)
    })

    const link = document.createElement('a')
    link.download = `dote-${size}x${size}-${transparent ? 'transparent' : 'white'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Dote Studio</p>
          <h1>かたつむり</h1>
        </div>
        <div className="status">
          <span>{size} x {size}</span>
          <span>{filledCount} px</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="tool-panel" aria-label="ツール">
          <div className="panel-group">
            <p className="panel-label">ツール</p>
            <div className="tool-grid">
              <button className={tool === 'pencil' ? 'active' : ''} type="button" onClick={() => setTool('pencil')}>ペン</button>
              <button className={tool === 'eraser' ? 'active' : ''} type="button" onClick={() => setTool('eraser')}>消しゴム</button>
              <button className={tool === 'fill' ? 'active' : ''} type="button" onClick={() => setTool('fill')}>塗りつぶし</button>
              <button className={tool === 'picker' ? 'active' : ''} type="button" onClick={() => setTool('picker')}>スポイト</button>
            </div>
          </div>

          <div className="panel-group">
            <p className="panel-label">色</p>
            <div className="color-control">
              <input type="color" value={color} onChange={(event) => chooseColor(event.target.value)} aria-label="描画色" />
              <input
                className="hex-input"
                type="text"
                value={colorDraft}
                onChange={(event) => handleHexColorChange(event.target.value)}
                onBlur={() => setColorDraft(color)}
                aria-label="色コード"
                maxLength="7"
              />
              <button type="button" onClick={addPaletteColor}>保存</button>
            </div>
            <div className="history-group">
              <span>履歴</span>
              <div className="color-history" aria-label="直近の色">
                {recentColors.map((item) => (
                  <div className="swatch-item" key={item} style={{ '--swatch': item }}>
                    <button
                      className={item === color ? 'swatch-button selected' : 'swatch-button'}
                      type="button"
                      onClick={() => chooseColor(item)}
                      aria-label={`${item} を選択`}
                    />
                    <button
                      className="delete-color"
                      type="button"
                      onClick={() => removeRecentColor(item)}
                      aria-label={`${item} を履歴から削除`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="palette" aria-label="パレット">
              {palette.map((item) => (
                <div className="swatch-item" key={item} style={{ '--swatch': item }}>
                  <button
                    className={item === color ? 'swatch-button selected' : 'swatch-button'}
                    type="button"
                    onClick={() => chooseColor(item)}
                    aria-label={`${item} を選択`}
                  />
                  <button
                    className="delete-color"
                    type="button"
                    onClick={() => removePaletteColor(item)}
                    aria-label={`${item} をパレットから削除`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="panel-group">
            <p className="panel-label">ブラシ</p>
            <div className="range-row">
              <input
                type="range"
                min="1"
                max="5"
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                aria-label="ブラシサイズ"
              />
              <span>{brushSize}</span>
            </div>
          </div>

          <div className="panel-group">
            <p className="panel-label">対称</p>
            <label className="switch-row">
              <input type="checkbox" checked={mirrorX} onChange={(event) => setMirrorX(event.target.checked)} />
              <span>左右</span>
            </label>
            <label className="switch-row">
              <input type="checkbox" checked={mirrorY} onChange={(event) => setMirrorY(event.target.checked)} />
              <span>上下</span>
            </label>
          </div>
        </aside>

        <section className="canvas-area" aria-label="キャンバス">
          <div className="canvas-toolbar">
            <div className="segmented" aria-label="キャンバスサイズ">
              {SIZES.map((item) => (
                <button
                  key={item}
                  className={item === size ? 'active' : ''}
                  type="button"
                  onClick={() => resizeCanvas(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <label className="grid-toggle">
              <input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />
              <span>グリッド</span>
            </label>
          </div>

          <div
            className={`pixel-canvas ${showGrid ? 'show-grid' : ''}`}
            style={{ '--size': size }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={finishStroke}
            onLostPointerCapture={finishStroke}
          >
            {pixels.map((pixel, index) => (
              <button
                key={index}
                className={pixel === TRANSPARENT ? 'pixel empty' : 'pixel'}
                style={{ '--pixel-color': pixel }}
                type="button"
                aria-label={`${index % size}, ${Math.floor(index / size)}`}
              />
            ))}
          </div>
        </section>

        <aside className="action-panel" aria-label="操作">
          <button type="button" onClick={undo} disabled={!history.length}>Undo</button>
          <button type="button" onClick={redo} disabled={!future.length}>Redo</button>
          <button type="button" onClick={clearCanvas}>クリア</button>
          <button className="primary-action" type="button" onClick={() => exportPng({ transparent: true })}>透過で書き出し</button>
          <button className="primary-action" type="button" onClick={() => exportPng({ transparent: false })}>白背景で書き出し</button>
        </aside>
      </section>
    </main>
  )
}

export default App
