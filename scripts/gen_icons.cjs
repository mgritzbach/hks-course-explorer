/**
 * Generates Android mipmap icons from an inline SVG using sharp.
 * Run: node scripts/gen_icons.js
 */
const fs   = require('fs')
const path = require('path')

// Harvard Crimson shield icon as SVG (1024x1024 source)
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- Background circle -->
  <rect width="1024" height="1024" fill="#A51C30" rx="200"/>
  <!-- Shield outline -->
  <path d="M 512 120 L 800 220 L 800 580 Q 800 780 512 920 Q 224 780 224 580 L 224 220 Z"
        fill="#8B1525" stroke="#fff" stroke-width="12" stroke-linejoin="round"/>
  <!-- Shield inner highlight -->
  <path d="M 512 160 L 770 248 L 770 575 Q 770 750 512 878 Q 254 750 254 575 L 254 248 Z"
        fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="6"/>
  <!-- VE RI TAS text (3 open books style) -->
  <!-- Top book -->
  <rect x="430" y="290" width="164" height="110" rx="8" fill="#fff" opacity="0.95"/>
  <line x1="512" y1="290" x2="512" y2="400" stroke="#A51C30" stroke-width="6"/>
  <text x="472" y="358" font-family="Georgia,serif" font-size="52" font-weight="bold" fill="#A51C30">VE</text>
  <!-- Middle-left book -->
  <rect x="340" y="430" width="148" height="100" rx="8" fill="#fff" opacity="0.95"/>
  <line x1="414" y1="430" x2="414" y2="530" stroke="#A51C30" stroke-width="5"/>
  <text x="354" y="495" font-family="Georgia,serif" font-size="46" font-weight="bold" fill="#A51C30">RI</text>
  <!-- Middle-right book -->
  <rect x="536" y="430" width="148" height="100" rx="8" fill="#fff" opacity="0.95"/>
  <line x1="610" y1="430" x2="610" y2="530" stroke="#A51C30" stroke-width="5"/>
  <text x="550" y="495" font-family="Georgia,serif" font-size="46" font-weight="bold" fill="#A51C30">TAS</text>
  <!-- Bottom label -->
  <text x="512" y="690" font-family="Georgia,serif" font-size="48" font-weight="bold"
        fill="#fff" text-anchor="middle" letter-spacing="4">HKS</text>
  <text x="512" y="740" font-family="Georgia,serif" font-size="26"
        fill="rgba(255,255,255,0.8)" text-anchor="middle" letter-spacing="2">COURSE EXPLORER</text>
</svg>`

const SIZES = {
  'mipmap-mdpi':    48,
  'mipmap-hdpi':    72,
  'mipmap-xhdpi':   96,
  'mipmap-xxhdpi':  144,
  'mipmap-xxxhdpi': 192,
}

const BASE = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res')

async function main() {
  let sharp
  try {
    sharp = require('sharp')
  } catch {
    console.log('sharp not found — installing...')
    require('child_process').execSync('npm install sharp --no-save', { stdio: 'inherit' })
    sharp = require('sharp')
  }

  const svgBuf = Buffer.from(SVG)
  for (const [dir, size] of Object.entries(SIZES)) {
    const outDir = path.join(BASE, dir)
    fs.mkdirSync(outDir, { recursive: true })
    const outPath = path.join(outDir, 'ic_launcher.png')
    await sharp(svgBuf).resize(size, size).png().toFile(outPath)
    // Also write ic_launcher_round.png (same image, Android uses it for circular icons)
    await sharp(svgBuf).resize(size, size).png().toFile(path.join(outDir, 'ic_launcher_round.png'))
    console.log(`✓ ${dir} (${size}px)`)
  }
  console.log('Icons generated.')
}

main().catch(e => { console.error(e); process.exit(1) })
