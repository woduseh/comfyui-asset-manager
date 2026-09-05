import { jsonResult } from './response'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { tagService } from '../../tags'

export function registerTagTools(server: McpServer): void {
  // === Danbooru Tag Tools ===

  server.tool(
    'validate_danbooru_tags',
    'Validate whether given tags are valid Danbooru tags. Returns validation result for each tag with suggestions for invalid ones. Use for Danbooru tag prompts only; do not validate natural-language prompts as tags. Local DB has ~6500 popular tags. Tags not found locally are checked via Danbooru API if online_fallback is true. If the API is unreachable, unknown tags are marked as "unverified" (valid=null) instead of invalid.',
    {
      tags: z
        .array(z.string())
        .min(1)
        .max(200)
        .describe('List of tags to validate (e.g. ["blue_eyes", "long_hair", "school_uniform"])'),
      online_fallback: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'If true, check Danbooru API for tags not found locally (default: true). Set to false in offline environments to skip network checks entirely.'
        )
    },
    async ({ tags, online_fallback }) => {
      if (!tagService.isLoaded()) {
        tagService.load()
        if (!tagService.isLoaded()) {
          const detail = tagService.lastError ? ` (${tagService.lastError})` : ''
          return {
            content: [
              { type: 'text', text: `Tag database not loaded${detail}. Please check the log.` }
            ],
            isError: true
          }
        }
      }

      const { results, onlineAvailable } = await tagService.validate(tags, online_fallback)
      const validCount = results.filter((r) => r.valid === true).length
      const invalidCount = results.filter((r) => r.valid === false).length
      const unverifiedCount = results.filter((r) => r.valid === null).length

      let summary = `${validCount}/${tags.length} tags valid`
      if (invalidCount > 0) summary += `, ${invalidCount} invalid`
      if (unverifiedCount > 0)
        summary += `, ${unverifiedCount} unverified (not in local DB, online unavailable)`

      return jsonResult({
        summary,
        online_available: onlineAvailable,
        local_tag_count: tagService.getTagCount(),
        results
      })
    }
  )

  server.tool(
    'search_danbooru_tags',
    'Search for Danbooru tags matching a query. Use this to find the correct tag name for a concept. Supports wildcard (*) patterns. Results are sorted by popularity (post count). Searches local DB (~6500 tags) first, supplements with Danbooru API if reachable. Works fully offline with local results only.',
    {
      query: z
        .string()
        .describe('Search query (e.g. "blue_eye", "long_h*", "school"). Supports * wildcard.'),
      category: z
        .enum(['general', 'artist', 'copyright', 'character', 'meta'])
        .optional()
        .describe('Filter by tag category'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(20)
        .describe('Max results (default: 20, max: 50)')
    },
    async ({ query, category, limit }) => {
      if (!tagService.isLoaded()) {
        tagService.load()
        if (!tagService.isLoaded()) {
          const detail = tagService.lastError ? ` (${tagService.lastError})` : ''
          return {
            content: [
              { type: 'text', text: `Tag database not loaded${detail}. Please check the log.` }
            ],
            isError: true
          }
        }
      }

      const clampedLimit = Math.min(limit ?? 20, 50)
      const results = await tagService.searchWithOnline(query, category, clampedLimit)

      return jsonResult({
        query,
        count: results.length,
        tags: tagService.formatTagsForDisplay(results)
      })
    }
  )

  server.tool(
    'get_popular_danbooru_tags',
    'Get popular Danbooru tags sorted by usage count. Use group_by_semantic=true to get tags organized by category (hair, eyes, clothing, pose, etc.) — very useful when writing character prompts. Uses local DB only — works fully offline.',
    {
      category: z
        .enum(['general', 'artist', 'copyright', 'character', 'meta'])
        .optional()
        .describe('Filter by tag category (most character-related tags are "general")'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(100)
        .describe('Max results per group or total (default: 100, max: 500)'),
      group_by_semantic: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'If true, returns tags grouped by semantic category (hair_color, eye_color, clothing, pose, etc.)'
        )
    },
    async ({ category, limit, group_by_semantic }) => {
      if (!tagService.isLoaded()) {
        tagService.load()
        if (!tagService.isLoaded()) {
          const detail = tagService.lastError ? ` (${tagService.lastError})` : ''
          return {
            content: [
              { type: 'text', text: `Tag database not loaded${detail}. Please check the log.` }
            ],
            isError: true
          }
        }
      }

      if (group_by_semantic) {
        const groups = tagService.getPopularGrouped()
        return jsonResult({
          description:
            'Popular Danbooru tags grouped by semantic category. Use these as reference when writing prompts.',
          groups
        })
      }

      const clampedLimit = Math.min(limit ?? 100, 500)
      const results = tagService.getPopular(category, clampedLimit)

      return jsonResult({
        count: results.length,
        tags: tagService.formatTagsForDisplay(results)
      })
    }
  )

  // === Danbooru Tag Prompt Template ===

  server.prompt(
    'danbooru_tag_guide',
    'Guidelines and reference for writing image generation prompts using Danbooru tags. Call this when creating Danbooru tag-based character prompts to get the correct tag format and popular tags.',
    {
      character_description: z
        .string()
        .optional()
        .describe('Optional character description for context-aware guidance')
    },
    ({ character_description }) => {
      const groups = tagService.isLoaded() ? tagService.getPopularGrouped() : {}

      let guideText = `# Danbooru Tag Prompt Guide

## Tag Format Rules
- Use **underscores** instead of spaces: \`long_hair\` not \`long hair\`
- All lowercase: \`blue_eyes\` not \`Blue_Eyes\`
- Use established compound tags: \`hair_ornament\`, \`looking_at_viewer\`
- Separate tags with commas: \`1girl, solo, long_hair, blue_eyes\`
- Do NOT invent new tags — always verify with \`validate_danbooru_tags\` tool

## Tag Categories (Danbooru)
- **General (0)**: Descriptive tags for appearance, actions, objects (most commonly used)
- **Artist (1)**: Artist name tags
- **Copyright (3)**: Series/franchise tags
- **Character (4)**: Specific character name tags
- **Meta (5)**: Technical tags (e.g., highres, absurdres)

## Prompt Writing Tips
1. Start with composition: \`1girl, solo\` or \`2girls, multiple_girls\`
2. Add hair: color + style (e.g., \`blonde_hair, long_hair, ponytail\`)
3. Add eyes: \`blue_eyes\`, \`red_eyes\`, etc.
4. Add expression: \`smile\`, \`blush\`, \`open_mouth\`
5. Add clothing: \`school_uniform\`, \`dress\`, \`armor\`
6. Add accessories: \`hair_ribbon\`, \`glasses\`, \`hat\`
7. Add pose/action: \`standing\`, \`sitting\`, \`looking_at_viewer\`
8. Add background: \`simple_background\`, \`outdoors\`, \`classroom\`

## ⚠️ IMPORTANT
- ALWAYS use \`validate_danbooru_tags\` to verify tags before using them in prompts
- Use \`search_danbooru_tags\` to find the correct tag when unsure
- Use \`get_popular_danbooru_tags\` with \`group_by_semantic=true\` for reference
`

      if (Object.keys(groups).length > 0) {
        guideText += '\n## Popular Tags by Category\n'
        for (const [group, tags] of Object.entries(groups)) {
          if (tags.length > 0) {
            const displayName = group.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
            guideText += `\n### ${displayName}\n\`${tags.slice(0, 20).join(', ')}\`\n`
          }
        }
      }

      if (character_description) {
        guideText += `\n## Your Character Description\n"${character_description}"\n\nPlease use the tags above and the \`search_danbooru_tags\` tool to find appropriate tags for this character. Validate all tags with \`validate_danbooru_tags\` before creating the module item.\n`
      }

      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: guideText }
          }
        ]
      }
    }
  )
}
