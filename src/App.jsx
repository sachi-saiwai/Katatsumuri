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
const STARTING_HSV = hexToHsv(STARTING_COLOR)

function createPixels(size) {
  return Array.from({ length: size * size }, () => TRANSPARENT)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function pixelsEqual(first, second) {
  return first.length === second.length && first.every((pixel, index) => pixel === second[index])
}

function componentToHex(value) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
}

function rgbToHex(red, green, blue) {
  return `#${componentToHex(red)}${componentToHex(green)}${componentToHex(blue)}`
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null

  return {
    red: parseInt(normalized.slice(0, 2), 16),
    green: parseInt(normalized.slice(2, 4), 16),
    blue: parseInt(normalized.slice(4, 6), 16),
  }
}

function hsvToHex({ hue, saturation, value }) {
  const chroma = value * saturation
  const huePrime = hue / 60
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1))
  const match = value - chroma
  let red = 0
  let green = 0
  let blue = 0

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma
    green = x
  } else if (huePrime < 2) {
    red = x
    green = chroma
  } else if (huePrime < 3) {
    green = chroma
    blue = x
  } else if (huePrime < 4) {
    green = x
    blue = chroma
  } else if (huePrime < 5) {
    red = x
    blue = chroma
  } else {
    red = chroma
    blue = x
  }

  return rgbToHex((red + match) * 255, (green + match) * 255, (blue + match) * 255)
}

function hexToHsv(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return { hue: 0, saturation: 0, value: 0 }

  const red = rgb.red / 255
  const green = rgb.green / 255
  const blue = rgb.blue / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let hue = 0

  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6)
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2)
    } else {
      hue = 60 * ((red - green) / delta + 4)
    }
  }

  return {
    hue: Math.round((hue + 360) % 360),
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  }
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

function pointToColorField(clientX, clientY, element) {
  const rect = element.getBoundingClientRect()

  return {
    saturation: clamp((clientX - rect.left) / rect.width, 0, 1),
    value: clamp(1 - (clientY - rect.top) / rect.height, 0, 1),
  }
}

function App() {
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [pixels, setPixels] = useState(() => createPixels(DEFAULT_SIZE))
  const pixelsRef = useRef(pixels)
  const strokeStartRef = useRef(null)
  const lastPaintIndexRef = useRef(null)
  const activePointerIdRef = useRef(null)
  const isDrawingRef = useRef(false)
  const activeColorPointerIdRef = useRef(null)
  const colorPanelRef = useRef(null)
  const [history, setHistory] = useState([])
  const [future, setFuture] = useState([])
  const [tool, setTool] = useState('pencil')
  const [color, setColor] = useState(STARTING_COLOR)
  const [colorDraft, setColorDraft] = useState(STARTING_COLOR)
  const [hsv, setHsv] = useState(STARTING_HSV)
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false)
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

  useEffect(() => {
    if (!isColorPickerOpen) return undefined

    function closeColorPicker(event) {
      if (colorPanelRef.current?.contains(event.target)) return
      setIsColorPickerOpen(false)
    }

    function closeColorPickerWithKey(event) {
      if (event.key === 'Escape') setIsColorPickerOpen(false)
    }

    window.addEventListener('pointerdown', closeColorPicker)
    window.addEventListener('keydown', closeColorPickerWithKey)
    return () => {
      window.removeEventListener('pointerdown', closeColorPicker)
      window.removeEventListener('keydown', closeColorPickerWithKey)
    }
  }, [isColorPickerOpen])

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

  function chooseColor(nextColor, { rememberColor = true, syncHsv = true } = {}) {
    setColor(nextColor)
    setColorDraft(nextColor)
    if (syncHsv) setHsv(hexToHsv(nextColor))
    if (rememberColor) {
      setRecentColors((items) => [nextColor, ...items.filter((item) => item !== nextColor)].slice(0, 4))
    }
  }

  function chooseHsv(nextHsv, { rememberColor = false } = {}) {
    const normalized = {
      hue: clamp(Number(nextHsv.hue), 0, 359),
      saturation: clamp(Number(nextHsv.saturation), 0, 1),
      value: clamp(Number(nextHsv.value), 0, 1),
    }

    setHsv(normalized)
    chooseColor(hsvToHex(normalized), { rememberColor, syncHsv: false })
  }

  function handleHexColorChange(value) {
    const normalized = value.startsWith('#') ? value : `#${value}`
    setColorDraft(normalized)
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      chooseColor(normalized)
    }
  }

  function handleHueChange(value) {
    chooseHsv({ ...hsv, hue: Number(value) })
  }

  function handleSaturationChange(value) {
    chooseHsv({ ...hsv, saturation: Number(value) / 100 })
  }

  function handleValueChange(value) {
    chooseHsv({ ...hsv, value: Number(value) / 100 })
  }

  function handleColorFieldPointerDown(event) {
    event.preventDefault()
    activeColorPointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    chooseHsv({
      ...hsv,
      ...pointToColorField(event.clientX, event.clientY, event.currentTarget),
    })
  }

  function handleColorFieldPointerMove(event) {
    if (activeColorPointerIdRef.current !== event.pointerId) return

    event.preventDefault()
    chooseHsv({
      ...hsv,
      ...pointToColorField(event.clientX, event.clientY, event.currentTarget),
    })
  }

  function handleColorFieldPointerEnd(event) {
    if (activeColorPointerIdRef.current !== event.pointerId) return

    activeColorPointerIdRef.current = null
    chooseColor(color)
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

          <div className="panel-group color-panel" ref={colorPanelRef}>
            <p className="panel-label">色</p>
            <div className="color-control">
              <button
                className="current-color"
                type="button"
                style={{ '--swatch': color }}
                aria-label={`カラーパレットを${isColorPickerOpen ? '閉じる' : '開く'} ${color}`}
                aria-expanded={isColorPickerOpen}
                onClick={() => setIsColorPickerOpen((current) => !current)}
              />
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
            {isColorPickerOpen && (
              <div className="color-picker" role="dialog" aria-label="カラーパレット">
                <div
                  className="color-field"
                  style={{
                    '--picker-hue': hsv.hue,
                    '--picker-saturation': `${hsv.saturation * 100}%`,
                    '--picker-value': `${(1 - hsv.value) * 100}%`,
                  }}
                  role="slider"
                  tabIndex="0"
                  aria-label="彩度と明度"
                  aria-valuetext={`彩度 ${Math.round(hsv.saturation * 100)}%, 明度 ${Math.round(hsv.value * 100)}%`}
                  onPointerDown={handleColorFieldPointerDown}
                  onPointerMove={handleColorFieldPointerMove}
                  onPointerUp={handleColorFieldPointerEnd}
                  onPointerCancel={handleColorFieldPointerEnd}
                  onLostPointerCapture={() => {
                    activeColorPointerIdRef.current = null
                  }}
                >
                  <span className="color-field-thumb" />
                </div>
                <label className="color-slider hue-slider">
                  <span>H</span>
                  <input
                    type="range"
                    min="0"
                    max="359"
                    value={Math.round(hsv.hue)}
                    onInput={(event) => handleHueChange(event.currentTarget.value)}
                    onChange={(event) => handleHueChange(event.currentTarget.value)}
                    aria-label="色相"
                  />
                </label>
                <label className="color-slider saturation-slider" style={{ '--picker-color': hsvToHex({ ...hsv, saturation: 1 }) }}>
                  <span>S</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(hsv.saturation * 100)}
                    onInput={(event) => handleSaturationChange(event.currentTarget.value)}
                    onChange={(event) => handleSaturationChange(event.currentTarget.value)}
                    aria-label="彩度"
                  />
                </label>
                <label className="color-slider value-slider" style={{ '--picker-color': hsvToHex({ ...hsv, value: 1 }) }}>
                  <span>V</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(hsv.value * 100)}
                    onInput={(event) => handleValueChange(event.currentTarget.value)}
                    onChange={(event) => handleValueChange(event.currentTarget.value)}
                    aria-label="明度"
                  />
                </label>
              </div>
            )}
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
