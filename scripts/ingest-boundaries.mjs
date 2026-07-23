import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(rootDir, 'public', 'data', 'boundaries')

const sources = {
  utah: 'https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/Utah_Big_Game_Hunt_Boundaries_2025/FeatureServer',
  colorado: 'https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer/6',
  idahoGeneral: 'https://services.arcgis.com/FjJI5xHF2dUPVrgK/arcgis/rest/services/GameManagementUnits/FeatureServer/0',
  idahoControlled: 'https://services.arcgis.com/FjJI5xHF2dUPVrgK/arcgis/rest/services/ControlledHunts_All/FeatureServer/0',
  wyomingDeer: 'https://services6.arcgis.com/cWzdqIyxbijuhPLw/arcgis/rest/services/2026_Deer_Hunt_Areas/FeatureServer/0',
  wyomingElk: 'https://services6.arcgis.com/cWzdqIyxbijuhPLw/arcgis/rest/services/2025_Elk_HAs/FeatureServer/0',
  wyomingPronghorn: 'https://services6.arcgis.com/cWzdqIyxbijuhPLw/arcgis/rest/services/AntelopeHuntAreas/FeatureServer/0',
  wyomingMoose: 'https://services6.arcgis.com/cWzdqIyxbijuhPLw/arcgis/rest/services/MooseHuntAreas/FeatureServer/0',
  wyomingSheep: 'https://services6.arcgis.com/cWzdqIyxbijuhPLw/arcgis/rest/services/BighornSheepHuntAreas/FeatureServer/0',
  wyomingGoat: 'https://services6.arcgis.com/cWzdqIyxbijuhPLw/arcgis/rest/services/RockyMountainGoatHuntAreas/FeatureServer/0',
}

async function main() {
  await mkdir(outputDir, { recursive: true })

  const utahHuntRows = await fetchAttributes(`${sources.utah}/1`, '1=1', '*')
  const huntsByBoundary = new Map()
  for (const row of utahHuntRows) {
    const key = String(row.boundary_id)
    const values = huntsByBoundary.get(key) ?? []
    if (row.hunt_num) values.push(String(row.hunt_num))
    huntsByBoundary.set(key, values)
  }

  const jobs = [
    {
      file: 'utah.json', state: 'utah', year: 2025, label: 'UDWR big game hunt boundaries',
      source: `${sources.utah}/0`, where: '1=1', fields: 'BoundaryID,Boundary_Name',
      normalize: (props) => ({
        id: String(props.BoundaryID),
        name: props.Boundary_Name,
        huntNumbers: unique(huntsByBoundary.get(String(props.BoundaryID)) ?? []),
      }),
    },
    {
      file: 'colorado.json', state: 'colorado', year: 2026, label: 'CPW big game management units',
      source: sources.colorado, where: '1=1', fields: 'GMUID,COUNTY',
      normalize: (props) => ({ id: String(props.GMUID), name: `GMU ${props.GMUID}`, detail: props.COUNTY }),
    },
    {
      file: 'idaho-general.json', state: 'idaho', year: 2026, label: 'IDFG game management units',
      source: sources.idahoGeneral, where: '1=1', fields: 'ID,NAME,Elk_Zone',
      normalize: (props) => ({ id: String(props.NAME), name: `Unit ${props.NAME}`, detail: props.Elk_Zone || null }),
    },
    {
      file: 'idaho-controlled.json', state: 'idaho', year: 2025, label: 'IDFG controlled hunt areas',
      source: sources.idahoControlled,
      where: "Year=2025 AND BigGame IN ('Deer','Elk','Pronghorn','Moose','Bighorn Sheep','Mountain Goat','Black Bear')",
      fields: 'BigGame,HuntArea,Year',
      normalize: (props) => ({ id: String(props.HuntArea), name: `Area ${props.HuntArea}`, species: idahoSpecies(props.BigGame) }),
    },
    {
      file: 'wyoming-deer.json', state: 'wyoming', year: 2026, label: 'WGFD deer hunt areas',
      source: sources.wyomingDeer, where: '1=1', fields: 'HUNTAREA,HUNTNAME,Region',
      normalize: (props) => ({ id: String(props.HUNTAREA), name: props.HUNTNAME || `Hunt Area ${props.HUNTAREA}`, detail: props.Region ? `Region ${props.Region}` : null }),
    },
    {
      file: 'wyoming-elk.json', state: 'wyoming', year: 2025, label: 'WGFD elk hunt areas',
      source: sources.wyomingElk, where: '1=1', fields: 'HUNTAREA,HUNTNAME,Region',
      normalize: (props) => ({ id: String(props.HUNTAREA), name: props.HUNTNAME || `Hunt Area ${props.HUNTAREA}`, detail: props.Region ? `Region ${props.Region}` : null }),
    },
    {
      file: 'wyoming-pronghorn.json', state: 'wyoming', year: 2025, label: 'WGFD pronghorn hunt areas',
      source: sources.wyomingPronghorn, where: '1=1', fields: 'HUNTAREA,HUNTNAME,HERDNAME',
      normalize: (props) => ({ id: String(props.HUNTAREA), name: props.HUNTNAME || `Hunt Area ${props.HUNTAREA}`, detail: props.HERDNAME || null }),
    },
    {
      file: 'wyoming-moose.json', state: 'wyoming', year: 2025, label: 'WGFD moose hunt areas',
      source: sources.wyomingMoose, where: '1=1', fields: 'HUNTAREA,HUNTNAME,HERDNAME',
      normalize: (props) => ({ id: String(props.HUNTAREA), name: props.HUNTNAME || `Hunt Area ${props.HUNTAREA}`, detail: props.HERDNAME || null }),
    },
    {
      file: 'wyoming-bighorn-sheep.json', state: 'wyoming', year: 2025, label: 'WGFD bighorn sheep hunt areas',
      source: sources.wyomingSheep, where: '1=1', fields: 'HUNTAREA,HUNTNAME,HERDNAME',
      normalize: (props) => ({ id: String(props.HUNTAREA), name: props.HUNTNAME || `Hunt Area ${props.HUNTAREA}`, detail: props.HERDNAME || null }),
    },
    {
      file: 'wyoming-mountain-goat.json', state: 'wyoming', year: 2025, label: 'WGFD mountain goat hunt areas',
      source: sources.wyomingGoat, where: '1=1', fields: 'HUNTAREA,HUNTNAME,HERDNAME',
      normalize: (props) => ({ id: String(props.HUNTAREA), name: props.HUNTNAME || `Hunt Area ${props.HUNTAREA}`, detail: props.HERDNAME || null }),
    },
  ]

  for (const job of jobs) {
    const geojson = await fetchGeoJson(job.source, job.where, job.fields)
    const features = geojson.features
      .map((feature) => ({
        ...job.normalize(feature.properties),
        geometry: normalizeGeometry(feature.geometry),
      }))
      .filter((feature) => feature.id && feature.geometry)
    const data = {
      state: job.state,
      year: job.year,
      label: job.label,
      sourceUrl: job.source.replace(/\/\d+$/, ''),
      features,
    }
    await writeFile(path.join(outputDir, job.file), `${JSON.stringify(data)}\n`)
    const size = Buffer.byteLength(JSON.stringify(data)) / 1024
    console.log(`${job.file}: ${features.length} boundaries, ${size.toFixed(0)} KB`)
  }
}

async function fetchGeoJson(layerUrl, where, outFields) {
  const url = new URL(`${layerUrl}/query`)
  url.searchParams.set('where', where)
  url.searchParams.set('outFields', outFields)
  url.searchParams.set('returnGeometry', 'true')
  url.searchParams.set('outSR', '4326')
  url.searchParams.set('geometryPrecision', '4')
  url.searchParams.set('maxAllowableOffset', '0.002')
  url.searchParams.set('f', 'geojson')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Boundary fetch failed ${response.status}: ${layerUrl}`)
  const data = await response.json()
  if (data.error) throw new Error(`${layerUrl}: ${data.error.message}`)
  return data
}

async function fetchAttributes(layerUrl, where, outFields) {
  const url = new URL(`${layerUrl}/query`)
  url.searchParams.set('where', where)
  url.searchParams.set('outFields', outFields)
  url.searchParams.set('returnGeometry', 'false')
  url.searchParams.set('f', 'json')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Attribute fetch failed ${response.status}: ${layerUrl}`)
  const data = await response.json()
  return (data.features ?? []).map((feature) => feature.attributes)
}

function normalizeGeometry(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return null
  return {
    type: geometry.type,
    coordinates: roundCoordinates(geometry.coordinates),
  }
}

function roundCoordinates(value) {
  if (!Array.isArray(value)) return value
  if (typeof value[0] === 'number') {
    return [Number(value[0].toFixed(4)), Number(value[1].toFixed(4))]
  }
  return value.map(roundCoordinates)
}

function idahoSpecies(value) {
  if (/deer/i.test(value)) return 'Deer'
  if (/elk/i.test(value)) return 'Elk'
  if (/pronghorn/i.test(value)) return 'Pronghorn'
  if (/moose/i.test(value)) return 'Moose'
  if (/sheep/i.test(value)) return 'Bighorn Sheep'
  if (/goat/i.test(value)) return 'Mountain Goat'
  if (/bear/i.test(value)) return 'Black Bear'
  return value
}

function unique(values) {
  return [...new Set(values)]
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
