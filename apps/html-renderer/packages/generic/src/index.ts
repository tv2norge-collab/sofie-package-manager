import { BrowserWindow, app, ipcMain } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

// boilerplate
export async function startProcess(): Promise<void> {
	// eslint-disable-next-line no-console

	await renderHTML({
		url: 'file://D:/templates/10mila/person.html',

		scripts: [
			{
				takeScreenshot: {
					name: 'capture/init.png',
				},
				wait: 0,
				startRecording: {
					name: 'C:\\git\\package-manager\\apps\\html-renderer\\packages\\generic\\recording',
				},
			},
			{
				executeJs: `update({name: 'johan'}); play();`,
				wait: 0,
			},
			{
				takeScreenshot: {
					name: 'capture/play.png',
				},
				wait: 1000,
			},
			{
				executeJs: `stop()`,
				wait: 0,
			},
			{
				takeScreenshot: {
					name: 'capture/stop.png',
				},
				wait: 1000,
			},
		],
	})
}
export async function renderHTML(options: {
	/** URL to the web page to render */
	url: string
	/** Width of the window */
	width?: number
	/** Height of the window */
	height?: number
	/** Background color, default to black */
	backgroundColor?: string
	/** Scripts to execute */
	scripts: {
		fcn?: (options: { webContents: Electron.WebContents }) => void | Promise<void>
		executeJs?: string
		takeScreenshot?: {
			/** PNG file */
			name: string
		}
		startRecording?: {
			name: string
		}
		wait: number
	}[]
	userAgent?: string
}): Promise<void> {
	await app.whenReady()

	const width = options.width || 1280
	const height = options.height || 720

	const win = new BrowserWindow({
		show: false,
		alwaysOnTop: true,
		webPreferences: {
			// preload: join(__dirname, 'preload.js'),
			nodeIntegration: false,
		},
		height,
		width,
	})

	win.webContents.setAudioMuted(true)
	if (options.userAgent) win.webContents.setUserAgent(options.userAgent)

	const startTime = Date.now()
	const log = (...args: any[]) => {
		// eslint-disable-next-line no-console
		console.log(pad(Date.now() - startTime, 6, ' '), ...args)
	}

	ipcMain.on('console', function (sender, type, args) {
		log('console', sender, type, args)
	})
	// win.webContents.on('did-finish-load', (e: unknown) => log('did-finish-load', e))
	// win.webContents.on('did-fail-load', (e: unknown) => log('did-fail-load', e))
	// win.webContents.on('did-fail-provisional-load', (e: unknown) => log('did-fail-provisional-load', e))
	// win.webContents.on('did-frame-finish-load', (e: unknown) => log('did-frame-finish-load', e))
	// win.webContents.on('did-start-loading', (e: unknown) => log('did-start-loading', e))
	// win.webContents.on('did-stop-loading', (e: unknown) => log('did-stop-loading', e))
	// win.webContents.on('dom-ready', (e: unknown) => log('dom-ready', e))
	// win.webContents.on('page-favicon-updated', (e: unknown) => log('page-favicon-updated', e))
	// win.webContents.on('will-navigate', (e: unknown) => log('will-navigate', e))
	// win.webContents.on('plugin-crashed', (e: unknown) => log('plugin-crashed', e))
	// win.webContents.on('destroyed', (e: unknown) => log('destroyed', e))

	log(`Loading URL: ${options.url}`)
	await win.loadURL(options.url)
	log(`Loading done`)

	win.title = `HTML Renderer ${process.pid}`

	await win.webContents.insertCSS(`html,body{ background-color: #${options.backgroundColor ?? '000000'} !important;}`)

	let exitCode = 0

	const executingScripts: Promise<any>[] = []
	let delay = 0
	for (const script of options.scripts) {
		delay += script.wait
		executingScripts.push(
			new Promise((resolve, reject) => {
				const runScript = async () => {
					if (script.fcn) {
						log(`Executing fcn`)
						await Promise.resolve(script.fcn({ webContents: win.webContents }))
					}
					if (script.executeJs) {
						log(`Executing js: ${script.executeJs}`)
						await win.webContents.executeJavaScript(script.executeJs)
					}
					if (script.takeScreenshot) {
						const image = await win.webContents.capturePage()
						// const image = await win.webContents.beginFrameSubscription
						log(`Taking screenshot: ${script.takeScreenshot.name}`)
						await fs.promises.writeFile(script.takeScreenshot.name, image.toPNG())
					}
					if (script.startRecording) {
						log(`Start recording: ${script.startRecording.name}`)
						// const sources = await desktopCapturer.getSources({ types: ['window'] })
						const filename = script.startRecording.name
						let i = 0

						const tmpFolder = path.resolve(`tmp-recording${process.pid}`)
						await fs.promises.mkdir(tmpFolder, {
							recursive: true,
						})
						const videoFilename = `${filename}.webm`
						const croppedVideoFilename = `${filename}-cropped.webm`
						let a = false
						const tmpFiles: string[] = []
						a = true

						try {
							await new Promise<void>((resolve) => {
								const endRecording = () => {
									log('ending recording')
									win.webContents.endFrameSubscription()
									resolve()
								}

								let endRecordingTimeout = setTimeout(() => {
									endRecording()
								}, 500)

								win.webContents.beginFrameSubscription(false, (image) => {
									i++
									// log(`frame ${i}`)

									const buffer = image
										.resize({
											width,
											height,
										})
										.toPNG()

									const tmpFile = path.join(tmpFolder, `img${pad(i, 5)}.png`)
									tmpFiles.push(tmpFile)
									fs.promises.writeFile(tmpFile, buffer).catch(console.error)

									// End recording when idle
									clearTimeout(endRecordingTimeout)
									endRecordingTimeout = setTimeout(() => {
										endRecording()
									}, 500)
								})
							})

							log(`Saving recording to ${videoFilename}`)
							// Convert the pngs to a video:
							await ffmpeg([
								'-y',
								'-framerate',
								'30',
								'-s',
								`${width}x${height}`,
								'-i',
								`${tmpFolder}/img%05d.png`,
								'-f',
								'webm', // format: webm
								'-an', // blocks all audio streams
								'-c:v',
								'libvpx-vp9', // encoder for video (use VP9)
								'-auto-alt-ref',
								'1',
								videoFilename,
							])

							// Figure out the active bounding box
							const boundingBox = {
								x1: Infinity,
								x2: -Infinity,
								y1: Infinity,
								y2: -Infinity,
							}
							await ffmpeg(['-i', videoFilename, '-vf', 'bbox=min_val=50', '-f', 'null', '-'], {
								onStderr: (data) => {
									// [Parsed_bbox_0 @ 000002b6f5d474c0] n:25 pts:833 pts_time:0.833 x1:205 x2:236 y1:614 y2:650 w:32 h:37 crop=32:37:205:614 drawbox=205:614:32:37
									const m = data.match(
										/Parsed_bbox.*x1:(?<x1>\d+).*x2:(?<x2>\d+).*y1:(?<y1>\d+).*y2:(?<y2>\d+)/
									)
									if (m && m.groups) {
										boundingBox.x1 = Math.min(boundingBox.x1, parseInt(m.groups.x1, 10))
										boundingBox.x2 = Math.max(boundingBox.x2, parseInt(m.groups.x2, 10))
										boundingBox.y1 = Math.min(boundingBox.y1, parseInt(m.groups.y1, 10))
										boundingBox.y2 = Math.max(boundingBox.y2, parseInt(m.groups.y2, 10))
									}
								},
							})

							// Add margins:
							boundingBox.x1 -= 10
							boundingBox.x2 += 10
							boundingBox.y1 -= 10
							boundingBox.y2 += 10

							log(`Saving cropped recording to ${croppedVideoFilename}`)
							// Generate a cropped video as well:
							await ffmpeg([
								'-y',
								'-i',
								videoFilename,
								'-filter:v',
								`crop=${boundingBox.x2 - boundingBox.x1}:${boundingBox.y2 - boundingBox.y1}:${
									boundingBox.x1
								}:${boundingBox.y1}`,
								croppedVideoFilename,
							])

							log(`Video: ${videoFilename}`)
							log(`Cropped video: ${croppedVideoFilename}`)
						} catch (e) {
							log(`Aborting due to an error: ${e}`)
							exitCode = 1
						} finally {
							log(`Removing temporary files....`)
							for (const tmpFile of tmpFiles) {
								await fs.promises.unlink(tmpFile)
							}
							await fs.promises.rm(tmpFolder, { recursive: true })
						}
					}
				}
				setTimeout(() => {
					runScript().then(resolve, reject)
				}, delay)
			})
		)
	}

	await Promise.all(executingScripts)
	log(`executed scripts done`)

	win.close()

	// eslint-disable-next-line no-process-exit
	process.exit(exitCode)
}
function pad(str: string | number, length: number, char = '0') {
	str = str.toString()
	while (str.length < length) {
		str = char + str
	}
	return str
}
async function ffmpeg(
	args: string[],
	options?: {
		onStdout?: (data: string) => void
		onStderr?: (data: string) => void
	}
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let logTrace = ''
		const child = spawn('ffmpeg', args)

		child.stdout.on('data', (data) => {
			options?.onStdout?.(data.toString())
			logTrace += data.toString() + '\n'
		})
		child.stderr.on('data', (data) => {
			options?.onStderr?.(data.toString())
			logTrace += data.toString() + '\n'
		})
		child.on('close', (code) => {
			if (code !== 0) {
				// eslint-disable-next-line no-console
				console.error(logTrace)
				reject(new Error(`ffmpeg process exited with code ${code}, args: ${args.join(' ')}`))
			} else resolve()
		})
	})
}
