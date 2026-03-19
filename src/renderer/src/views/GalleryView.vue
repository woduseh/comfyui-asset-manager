<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NEmpty, NGrid, NGridItem, NImage, NSpace, NRate } from 'naive-ui'
import { useGalleryStore } from '@renderer/stores/gallery.store'

const { t } = useI18n()
const galleryStore = useGalleryStore()

onMounted(() => {
  galleryStore.loadImages()
})
</script>

<template>
  <div class="gallery-view">
    <h2>{{ t('gallery.title') }}</h2>

    <NCard style="margin-top: 16px;">
      <template v-if="galleryStore.images.length > 0">
        <NGrid :cols="5" :x-gap="12" :y-gap="12">
          <NGridItem v-for="image in galleryStore.images" :key="image.id">
            <NCard size="small" hoverable>
              <NImage
                :src="'file://' + (image.thumbnail_path || image.file_path)"
                :width="200"
                object-fit="cover"
                style="aspect-ratio: 1; border-radius: 4px;"
              />
              <NSpace justify="center" style="margin-top: 8px;">
                <NRate
                  :value="image.rating"
                  :count="5"
                  size="small"
                  @update:value="(val: number) => galleryStore.rateImage(image.id, val)"
                />
              </NSpace>
            </NCard>
          </NGridItem>
        </NGrid>
      </template>
      <NEmpty v-else :description="t('gallery.empty')" />
    </NCard>
  </div>
</template>
