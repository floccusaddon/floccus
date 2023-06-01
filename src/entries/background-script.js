import Controller from '../lib/Controller'

Controller.getSingleton()
  .then(controller => controller.onLoad())
