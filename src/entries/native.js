import app from '../ui/native.js'
import Controller from '../lib/Controller'

app()

const onload = async() => {
  const controller = await Controller.getSingleton()
  controller.onLoad()
}
window.addEventListener('load', onload)
