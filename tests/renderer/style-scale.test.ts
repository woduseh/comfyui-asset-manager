import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'

const RENDERER_ROOT = join(__dirname, '../../src/renderer/src')
const FONT_SIZE_SCALE_PX = new Set([11, 12, 13, 14, 16, 18, 22, 28, 38])
const ALLOWED_RADIUS = /^(var\(--radius-(xs|sm|md|lg)\)|0|50%|999px)$/

function listStyleSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listStyleSources(path)
    return /\.(vue|css)$/.test(entry.name) ? [path] : []
  })
}

function findOffScaleValues(): string[] {
  const violations: string[] = []
  for (const file of listStyleSources(RENDERER_ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      const location = `${relative(RENDERER_ROOT, file)}:${index + 1}`
      for (const [, size] of line.matchAll(/font-size:\s*([\d.]+)px/g)) {
        if (!FONT_SIZE_SCALE_PX.has(Number(size))) {
          violations.push(`${location} font-size ${size}px`)
        }
      }
      for (const [, radius] of line.matchAll(
        /border-radius:\s*([^;"]+?)\s*(?:!important)?\s*[;"]/g
      )) {
        if (!ALLOWED_RADIUS.test(radius)) violations.push(`${location} border-radius ${radius}`)
      }
    })
  }
  return violations
}

describe('renderer style scale', () => {
  it('uses the shared font-size scale and radius tokens', () => {
    expect(
      findOffScaleValues(),
      `Use a font size from ${[...FONT_SIZE_SCALE_PX].join('/')}px and var(--radius-xs|sm|md|lg) for corners`
    ).toEqual([])
  })
})
