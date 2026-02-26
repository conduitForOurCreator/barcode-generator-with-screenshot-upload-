import { useCallback, useEffect } from 'react'
import JsBarcode from 'jsbarcode'
const bwipjs = require('bwip-js') as any
import { useBarcodeContext } from './BarcodeContext'
import { checkQRCode, jsBarcodeSupportedFormats } from '@/config/barcode-types'
import { parseLine } from '@/lib/parseLine'

export const useBarcodeGenerator = () => {
  const {
    input,
    setOutput,
    barcodeLength,
    barcodeHeight,
    showText,
    codeFormat,
    barcodeMargin,
  } = useBarcodeContext()

  const generateBarcodes = useCallback(() => {
    const lines = input.split('\n').filter((line) => line.trim() !== '')

    try {
      const barcodes = lines.map((line) => {
        const { barcodeValue: value, displayText } = parseLine(line)

        if (jsBarcodeSupportedFormats.includes(codeFormat.toUpperCase())) {
          // JsBarcode 配置
          const jsBarcodeConfig: Record<string, unknown> = {
            format: codeFormat.toUpperCase(),
            width: 2,
            height: barcodeHeight,
            displayValue: showText,
            font: 'Arial',
            fontSize: 15,
            margin: barcodeMargin,
            background: '#ffffff',
            lineColor: '#000000',
            textAlign: 'center',
            textPosition: 'bottom',
            textMargin: 2,
          }

          // When showText is on and user provided a custom caption, override
          // the rendered text (JsBarcode accepts a `text` option for this).
          if (showText && displayText !== undefined) {
            jsBarcodeConfig.text = displayText
          }

          const svg = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'svg',
          )

          try {
            JsBarcode(svg, value, jsBarcodeConfig)
          } catch (error) {
            console.error('JsBarcode generation error:', error)
            throw new Error(`Invalid barcode value for ${codeFormat}: ${value}`)
          }

          svg.setAttribute('width', `${barcodeLength}`)
          return `<div class="barcode-item">${svg.outerHTML}</div>`
        } else {
          // BWIP-JS 配置
          const scale = 2
          const MM_TO_PX = 2.835 * scale // 72 dpi / 25.4 mm/in
          const heightInMM = barcodeHeight / MM_TO_PX
          const widthInMM = barcodeLength / MM_TO_PX
          const marginInMM = barcodeMargin / scale

          // 检查是否是二维码类型
          const isQRCode = checkQRCode(codeFormat)

          const fontSize = 15 // 假设字体大小为15px
          const textMargin = 2 // 假设文本与条码之间的间距为2px

          const bwipConfig: Record<string, unknown> = {
            bcid: codeFormat.toLowerCase(),
            text: value,
            scale: scale,
            height: heightInMM,
            width: widthInMM,
            includetext: showText,
            padding: marginInMM,
            paddingbottom:
              isQRCode && showText
                ? marginInMM + fontSize / +textMargin
                : marginInMM,
            backgroundcolor: 'ffffff',
            barcolor: '000000',
          }

          // bwip-js: use `alttext` to override the human-readable text below bars
          if (showText && displayText !== undefined) {
            bwipConfig.alttext = displayText
          }

          let svgString
          try {
            svgString = bwipjs.toSVG(bwipConfig)
          } catch (error) {
            console.error('BWIP-JS generation error:', error)
            throw new Error(`Invalid barcode value for ${codeFormat}: ${value}`)
          }

          // Parse SVG and set dimensions
          const parser = new DOMParser()
          const doc = parser.parseFromString(svgString, 'image/svg+xml')
          const svg = doc.documentElement

          svg.setAttribute('width', `${barcodeLength}`)
          svg.setAttribute(
            'height',
            `${isQRCode && showText ? barcodeHeight + fontSize + textMargin : barcodeHeight}`,
          )

          if (isQRCode && showText) {
            // 使用 Canvas 测量文本宽度
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')

            if (ctx === null) {
              console.warn('Canvas 2D context not supported')
              return `<div class="barcode-item">${svg.outerHTML}</div>`
            }

            // Measure the caption text (or fall back to the barcode value)
            const labelText = displayText !== undefined ? displayText : value
            ctx.font = `${fontSize}px Arial`
            const textWidth = ctx.measureText(labelText).width

            // 计算缩放比例
            const availableWidth = barcodeLength - marginInMM * 2
            const scaleRatio = Math.min(1, availableWidth / textWidth)

            // 创建text元素
            const text = document.createElementNS(
              'http://www.w3.org/2000/svg',
              'text',
            )
            text.setAttribute('x', `${(marginInMM * 2 + barcodeLength) / 2}`)
            text.setAttribute(
              'y',
              `${barcodeHeight + marginInMM * 2 + fontSize + textMargin}`,
            )
            text.setAttribute('text-anchor', 'middle')
            text.setAttribute('font-family', 'Arial')
            text.setAttribute('font-size', `${fontSize}`)
            text.setAttribute('transform', `scale(${scaleRatio})`)
            text.setAttribute(
              'transform-origin',
              `${marginInMM + barcodeLength / 2} ${barcodeHeight + marginInMM * 2 + fontSize + textMargin}`,
            )
            text.setAttribute('fill', '#000000')

            text.textContent = labelText
            svg.appendChild(text)

            svg.setAttribute(
              'height',
              `${barcodeHeight + fontSize + textMargin + marginInMM * 2}`,
            )
          }
          return `<div class="barcode-item">${svg.outerHTML}</div>`
        }
      })

      setOutput(barcodes)
    } catch (error) {
      console.error('Error generating barcodes:', error)
      setOutput([
        `<p class="error-message">Error generating barcodes: ${error}</p>`,
      ])
    }
  }, [
    input,
    setOutput,
    codeFormat,
    barcodeHeight,
    showText,
    barcodeMargin,
    barcodeLength,
  ])

  useEffect(() => {
    generateBarcodes()
  }, [generateBarcodes])

  return { generateBarcodes }
}
