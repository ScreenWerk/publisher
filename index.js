import * as dotenv from 'dotenv'
import fetch from 'node-fetch'
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

dotenv.config()

if (!process.env.ENTU_URL) throw new Error('ENTU_URL missing in environment')
if (!process.env.ENTU_ACCOUNT) throw new Error('ENTU_ACCOUNT missing in environment')
if (!process.env.ENTU_KEY) throw new Error('ENTU_KEY missing in environment')
if (!process.env.SPACES_ENDPOINT) throw new Error('SPACES_ENDPOINT missing in environment')
if (!process.env.SPACES_BUCKET) throw new Error('SPACES_BUCKET missing in environment')
if (!process.env.SPACES_BUCKET2) throw new Error('SPACES_BUCKET2 missing in environment')
if (!process.env.SPACES_KEY) throw new Error('SPACES_KEY missing in environment')
if (!process.env.SPACES_SECRET) throw new Error('SPACES_SECRET missing in environment')

let TOKEN
let TOKEN_TIME

main()

async function main () {
  const publishedAt = new Date().toISOString()
  const screenGroups = await getAllData(publishedAt)

  for (const screenGroup of screenGroups) {
    for (const screen of screenGroup.screens) {
      console.log(`Uploading file ${screen.screenEid}.json`)

      const file = JSON.stringify(screen)

      await uploadJSON(process.env.SPACES_BUCKET, `screen/${screen.screenEid}.json`, file)
      await uploadJSON(process.env.SPACES_BUCKET2, `screen/${screen.screenEid}.json`, file)

      if (screen._mid) {
        await uploadJSON(process.env.SPACES_BUCKET, `screen/${screen._mid}.json`, file)
      }
    }

    console.log(`Updating screenGroup ${screenGroup.screenGroupEid}\n`)

    await updateScreenGruop(screenGroup.screenGroupEid, publishedAt)
  }

  setTimeout(main, 60 * 1000)
}

async function getAllData (publishedAt) {
  await getToken()

  const screenGroups = await getScreenGroups()
  console.log(`ScreenGroups: ${screenGroups.length}`)
  if (screenGroups.length === 0) return []

  const screens = await getScreens()
  console.log(`Screens: ${screens.length}`)
  if (screens.length === 0) return []

  const configurations = await getConfigurations()
  console.log(`Configurations: ${configurations.length}`)
  if (configurations.length === 0) return []

  const schedules = await getSchedules()
  console.log(`Schedules: ${schedules.length}`)
  if (schedules.length === 0) return []

  const layouts = await getLayouts()
  console.log(`Layouts: ${layouts.length}`)
  if (layouts.length === 0) return []

  const layoutPlaylists = await getLayoutPlaylists()
  console.log(`LayoutPlaylists: ${layoutPlaylists.length}`)
  if (layoutPlaylists.length === 0) return []

  const playlists = await getPlaylists()
  console.log(`Playlists: ${playlists.length}`)
  if (playlists.length === 0) return []

  const playlistMedias = await getPlaylistsMedias()
  console.log(`PlaylistMedias: ${playlistMedias.length}`)
  if (playlistMedias.length === 0) return []

  const medias = await getMedias()
  console.log(`Medias: ${medias.length}`)
  if (medias.length === 0) return []

  await uploadMedia(process.env.SPACES_BUCKET, medias)
  await uploadMedia(process.env.SPACES_BUCKET2, medias)

  return screenGroups.map((screenGroup) => {
    const screensForScreenGroup = screens.filter((x) => x.screenGroup === screenGroup._id)

    if (!screensForScreenGroup.length) {
      console.log(`ERROR: Screens not found for screenGroup ${screenGroup._id}`)
      return undefined
    }

    const configuration = configurations.find((x) => x._id === screenGroup.configuration)
    if (!configuration) {
      console.log(`ERROR: Configuration not found for screenGroup ${screenGroup._id}`)
      return undefined
    }

    const schedulesForConfiguration = schedules.filter((x) => x.configurations.includes(configuration._id))

    return {
      screenGroupEid: screenGroup._id,
      screens: screensForScreenGroup.map((screen) => ({
        _mid: screen._mid,
        configurationEid: configuration._id,
        screenGroupEid: screenGroup._id,
        screenEid: screen._id,
        publishedAt,
        updateInterval: configuration.updateInterval,
        schedules: schedulesForConfiguration.map((schedule) => {
          const layout = layouts.find((x) => x._id === schedule.layout)
          if (!layout) {
            console.log(`ERROR: Layout not found for schedule ${schedule._id}`)
            return undefined
          }

          const layoutPlaylistsForSchedule = layoutPlaylists.filter((x) => x.layouts.includes(layout._id))
          if (!layoutPlaylistsForSchedule.length) {
            console.log(`ERROR: LayoutPlaylists not found for layout ${layout._id}`)
            return undefined
          }

          return {
            eid: schedule._id,
            cleanup: schedule.cleanup,
            crontab: schedule.crontab,
            duration: schedule.duration,
            ordinal: schedule.ordinal,
            layoutEid: layout._id,
            name: layout.name,
            validFrom: schedule.validFrom,
            validTo: schedule.validTo,
            width: layout.width,
            height: layout.height,
            layoutPlaylists: layoutPlaylistsForSchedule.map((layoutPlaylist) => {
              const playlist = playlists.find((x) => x._id === layoutPlaylist.playlist)
              if (!playlist) {
                console.log(`ERROR: Playlist not found for layoutPlaylist ${layoutPlaylist._id}`)
                return undefined
              }

              const playlistMediasForLayoutPlaylist = playlistMedias.filter((x) => x.playlists.includes(playlist._id))
              if (!playlistMediasForLayoutPlaylist.length) {
                console.log(`ERROR: PlaylistMedias not found for playlist ${playlist._id}`)
                return undefined
              }

              let width = layoutPlaylist.width
              let height = layoutPlaylist.height

              if (layoutPlaylist.inPixels) {
                if (width < layoutPlaylist.left + layoutPlaylist.width) {
                  console.log(`ERROR: LayoutPlaylist ${layoutPlaylist._id} left+width (${layoutPlaylist.left}+${layoutPlaylist.width}=${layoutPlaylist.left + layoutPlaylist.width}) is outside of layout ${layout._id} width (${layout.width})`)
                  width = layoutPlaylist.left + layoutPlaylist.width
                }

                if (height < layoutPlaylist.top + layoutPlaylist.height) {
                  console.log(`ERROR: LayoutPlaylist ${layoutPlaylist._id} top+height (${layoutPlaylist.top}+${layoutPlaylist.height}=${layoutPlaylist.top + layoutPlaylist.height}) is outside of layout ${layout._id} height (${layout.height})`)
                  height = layoutPlaylist.top + layoutPlaylist.height
                }
              }

              return {
                eid: layoutPlaylist._id,
                name: playlist.name,
                left: layoutPlaylist.left,
                top: layoutPlaylist.top,
                width,
                height,
                inPixels: layoutPlaylist.inPixels,
                zindex: layoutPlaylist.zindex,
                loop: layoutPlaylist.loop,
                playlistEid: playlist._id,
                validFrom: playlist.validFrom,
                validTo: playlist.validTo,
                playlistMedias: playlistMediasForLayoutPlaylist.map((playlistMedia) => {
                  const media = medias.find((x) => x._id === playlistMedia.media)
                  if (!media) {
                    console.log(`ERROR: Media not found for playlistMedia ${playlistMedia._id}`)
                    return undefined
                  }

                  let validFrom = media.validFrom || playlistMedia.validFrom
                  let validTo = media.validTo || playlistMedia.validTo

                  if (validFrom && playlistMedia.validFrom && new Date(validFrom) < new Date(playlistMedia.validFrom)) {
                    validFrom = playlistMedia.validFrom
                  }

                  if (validTo && playlistMedia.validTo && new Date(validTo) > new Date(playlistMedia.validTo)) {
                    validTo = playlistMedia.validTo
                  }

                  return {
                    playlistMediaEid: playlistMedia._id,
                    duration: playlistMedia.duration,
                    delay: playlistMedia.delay,
                    mute: playlistMedia.mute,
                    ordinal: playlistMedia.ordinal,
                    stretch: playlistMedia.stretch,
                    mediaEid: media._id,
                    file: `${process.env.ENTU_URL}/${process.env.ENTU_ACCOUNT}/property/${media.fileId}?download=true`,
                    fileDO: `https://files.screenwerk.ee/media/${media._id}/${media.fileId}`,
                    fileName: media.fileName,
                    height: media.height,
                    width: media.width,
                    name: media.name,
                    type: media.type,
                    url: media.url,
                    validFrom,
                    validTo
                  }
                }).filter((x) => x !== undefined).sort((a, b) => a.ordinal - b.ordinal)
              }
            }).filter((x) => x?.playlistMedias.length > 0)
          }
        }).filter((x) => x?.layoutPlaylists.length > 0).sort((a, b) => a.ordinal - b.ordinal)

      })).filter((x) => x?.schedules.length > 0)
    }
  }).filter((x) => x?.screens.length > 0)
}

async function getToken () {
  const now = Date.now()
  const twentyFourHours = 24 * 60 * 60 * 1000

  if (TOKEN && TOKEN_TIME && (now - TOKEN_TIME < twentyFourHours)) return

  const response = await fetch(`${process.env.ENTU_URL}/auth?account=${process.env.ENTU_ACCOUNT}`, {
    headers: {
      Authorization: `Bearer ${process.env.ENTU_KEY}`,
      'User-Agent': 'SWPublisher'
    }
  })

  if (!response.ok) {
    console.error(await response.json())
    throw new Error('Failed to fetch token')
  }

  const { token } = await response.json()

  TOKEN = token
  TOKEN_TIME = now
}

async function getScreenGroups () {
  const { entities } = await apiFetch('entity', {
    '_type.string': 'sw_screen_group',
    'configuration._id.exists': true,
    'ispublished.boolean': true,
    props: [
      'configuration.reference'
      // 'feedback.string',
      // 'ispublished.boolean',
      // 'name.string',
      // 'published.datetime'
      // 'responsible.reference'
    ].join(','),
    limit: 9999
  })

  return entities.map((x) => ({
    _id: x._id,
    configuration: getValue(x.configuration, 'reference')
  }))
}

async function getScreens () {
  const { entities } = await apiFetch('entity', {
    '_type.string': 'sw_screen',
    'screen_group._id.exists': true,
    props: [
      '_mid.string',
      // 'customer.reference',
      // 'entu_api_key.string',
      // 'log.file',
      // 'name.string',
      // 'notes.string',
      // 'photo.file',
      // 'published.string',
      'screen_group.reference'
    ].join(','),
    limit: 9999
  })

  return entities.map((x) => ({
    _id: x._id,
    _mid: parseInt(getValue(x._mid)),
    screenGroup: getValue(x.screen_group, 'reference')
  }))
}

async function getConfigurations () {
  const { entities } = await apiFetch('entity', {
    '_type.string': 'sw_configuration',
    props: [
      // 'name.string',
      'update_interval.number'
    ].join(','),
    limit: 9999
  })

  return entities.map((x) => ({
    _id: x._id,
    updateInterval: getValue(x.update_interval, 'number')
  }))
}

async function getSchedules () {
  const { entities } = await apiFetch('entity', {
    '_type.string': 'sw_schedule',
    '_parent._id.exists': true,
    'layout._id.exists': true,
    props: [
      '_parent.reference',
      // 'action.string',
      'cleanup.boolean',
      'crontab.string',
      'duration.number',
      'layout.reference',
      // 'name.string',
      'ordinal.number',
      'valid_from.datetime',
      'valid_to.datetime'
    ].join(','),
    limit: 9999
  })

  return entities.map((x) => ({
    _id: x._id,
    configurations: x._parent?.map((x) => x.reference) || [],
    cleanup: getValue(x.cleanup, 'boolean') === true,
    crontab: getValue(x.crontab),
    duration: getValue(x.duration, 'number'),
    layout: getValue(x.layout, 'reference'),
    ordinal: getValue(x.ordinal, 'number') || 0,
    validFrom: getValue(x.valid_from, 'datetime'),
    validTo: getValue(x.valid_to, 'datetime')
  })).filter((x) => !x.validTo || new Date(x.validTo) >= new Date())
}

async function getLayouts () {
  const { entities } = await apiFetch('entity', {
    '_type.string': 'sw_layout',
    props: [
      'height.number',
      'name.string',
      'width.number'
    ].join(','),
    limit: 9999
  })

  return entities.map((x) => ({
    _id: x._id,
    height: getValue(x.height, 'number') || 0,
    name: getValue(x.name),
    width: getValue(x.width, 'number') || 0
  }))
}

async function getLayoutPlaylists () {
  const { entities } = await apiFetch('entity', {
    '_type.string': 'sw_layout_playlist',
    '_parent._id.exists': true,
    'playlist._id.exists': true,
    props: [
      '_parent.reference',
      'height.number',
      'in_pixels.boolean',
      'left.number',
      'loop.boolean',
      // 'name.string',
      'playlist.reference',
      'top.number',
      'width.number',
      'zindex.number'
    ].join(','),
    limit: 9999
  })

  return entities.map((x) => ({
    _id: x._id,
    height: getValue(x.height, 'number') || 0,
    inPixels: getValue(x.in_pixels, 'boolean') === true,
    layouts: x._parent?.map((x) => x.reference) || [],
    left: getValue(x.left, 'number') || 0,
    loop: getValue(x.loop, 'boolean') === true,
    playlist: getValue(x.playlist, 'reference'),
    top: getValue(x.top, 'number') || 0,
    width: getValue(x.width, 'number') || 0,
    zindex: getValue(x.zindex, 'number') || 0
  }))
}

async function getPlaylists () {
  const { entities } = await apiFetch('entity', {
    '_type.string': 'sw_playlist',
    props: [
      // 'animate.reference',
      // 'delay.number',
      'name.string',
      'valid_from.datetime',
      'valid_to.datetime'
    ].join(','),
    limit: 9999
  })

  return entities.map((x) => ({
    _id: x._id,
    name: getValue(x.name),
    validFrom: getValue(x.valid_from, 'datetime'),
    validTo: getValue(x.valid_to, 'datetime')
  })).filter((x) => !x.validTo || new Date(x.validTo) >= new Date())
}

async function getPlaylistsMedias () {
  const { entities } = await apiFetch('entity', {
    '_type.string': 'sw_playlist_media',
    '_parent._id.exists': true,
    'media._id.exists': true,
    props: [
      '_parent.reference',
      // 'animate.reference',
      'delay.number',
      'duration.number',
      'media.reference',
      'mute.boolean',
      // 'name.string',
      'ordinal.number',
      'stretch.boolean',
      'valid_from.datetime',
      'valid_to.datetime'
    ].join(','),
    limit: 9999
  })

  return entities.map((x) => ({
    _id: x._id,
    delay: getValue(x.delay, 'number') || 0,
    duration: getValue(x.duration, 'number'),
    media: getValue(x.media, 'reference'),
    mute: getValue(x.mute, 'boolean') === true,
    ordinal: getValue(x.ordinal, 'number') || 0,
    playlists: x._parent?.map((x) => x.reference) || [],
    stretch: getValue(x.stretch, 'boolean') === true,
    validFrom: getValue(x.valid_from, 'datetime'),
    validTo: getValue(x.valid_to, 'datetime')
  })).filter((x) => !x.validTo || new Date(x.validTo) >= new Date())
}

async function getMedias () {
  const { entities } = await apiFetch('entity', {
    '_type.string': 'sw_media',
    'type._id.exists': true,
    '_sharing.string': 'public',
    props: [
      'file._id',
      'file.filename',
      'height.number',
      'name.string',
      'type.string',
      'url.string',
      'valid_from.datetime',
      'valid_to.datetime',
      'width.number'
    ].join(','),
    limit: 9999
  })

  return entities.map((x) => ({
    _id: x._id,
    fileId: getValue(x.file, '_id'),
    fileName: getValue(x.file, 'filename'),
    height: getValue(x.height, 'number'),
    name: getValue(x.name),
    type: getValue(x.type),
    url: getValue(x.url),
    validFrom: getValue(x.valid_from, 'datetime'),
    validTo: getValue(x.valid_to, 'datetime'),
    width: getValue(x.width, 'number')
  })).filter((x) => !x.validTo || new Date(x.validTo) >= new Date())
}

async function updateScreenGruop (screenGroup, publishedAt) {
  const { entity } = await apiFetch(`entity/${screenGroup}`, {
    props: [
      'ispublished._id',
      'published._id'
    ].join(',')
  })

  if (!entity) return

  const isPublishedId = getValue(entity.ispublished, '_id')
  const publishedId = getValue(entity.published, '_id')

  const body = [
    { _id: isPublishedId, type: 'ispublished', boolean: false },
    { _id: publishedId, type: 'published', datetime: publishedAt }
  ]

  const response = await fetch(`${process.env.ENTU_URL}/${process.env.ENTU_ACCOUNT}/entity/${screenGroup}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'SWPublisher'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const { message } = await response.json()
    console.log(`ERROR: ${message}`)
  }
}

async function apiFetch (path, query) {
  const url = new URL(`${process.env.ENTU_URL}/${process.env.ENTU_ACCOUNT}/${path}`)
  if (query) url.search = new URLSearchParams(query).toString()

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'SWPublisher'
    }
  })

  if (!response.ok) {
    console.error(await response.json())
    throw new Error(`Failed to fetch ${path}`)
  }

  return response.json()
}

async function uploadJSON (bucket, key, file) {
  const spacesClient = new S3Client({
    region: process.env.SPACES_REGION,
    endpoint: process.env.SPACES_ENDPOINT,
    credentials: {
      accessKeyId: process.env.SPACES_KEY,
      secretAccessKey: process.env.SPACES_SECRET
    }
  })

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: file,
    ContentType: 'application/json',
    ACL: 'public-read',
    CacheControl: 'public, max-age=60'
  })

  await spacesClient.send(command)
}

async function uploadMedia (bucket, medias) {
  const spacesClient = new S3Client({
    region: process.env.SPACES_REGION,
    endpoint: process.env.SPACES_ENDPOINT,
    credentials: {
      accessKeyId: process.env.SPACES_KEY,
      secretAccessKey: process.env.SPACES_SECRET
    }
  })

  for (const media of medias) {
    if (!media.fileId) continue

    const key = `media/${media._id}/${media.fileId}`

    try {
      const headCommand = new HeadObjectCommand({
        Bucket: bucket,
        Key: key
      })

      await spacesClient.send(headCommand)
    } catch (err) {
      if (err.name === 'NotFound') {
        const url = `${process.env.ENTU_URL}/${process.env.ENTU_ACCOUNT}/property/${media.fileId}?download=true`
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'SWPublisher'
          },
          redirect: 'follow'
        })

        if (!response.ok) {
          console.error(`Failed to fetch file ${media._id}/${media.fileId}`)
          continue
        }

        const sanitizedFileName = encodeURIComponent(media.fileName)
        const upload = new Upload({
          client: spacesClient,
          params: {
            Bucket: bucket,
            Key: key,
            Body: response.body,
            ContentDisposition: `attachment;filename="${sanitizedFileName}"`,
            ContentType: response.headers.get('content-type') || 'application/octet-stream',
            ACL: 'public-read'
          }
        })

        await upload.done()

        console.log(`File ${media._id}/${media.fileId} uploaded`)
      } else {
        console.error(`Error checking file ${media._id}/${media.fileId}:`, err)
      }
    }
  }
}

function getValue (valueList = [], type = 'string', locale = 'en') {
  return valueList.find((x) => x.language === locale)?.[type] || valueList.find((x) => !x.language)?.[type] || valueList?.at(0)?.[type]
}
