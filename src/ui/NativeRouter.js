import Vue from 'vue'
import Router from 'vue-router'
import Tree from './views/native/Tree'
import NewAccount from './views/NewAccount'
import Update from './views/Update'
import ImportExport from './views/ImportExport'
import Donate from './views/Donate'
import Options from './views/native/Options'

Vue.use(Router)

export const routes = {
  TREE: 'TREE',
  ACCOUNT_OPTIONS: 'ACCOUNT_OPTIONS',
  NEW_ACCOUNT: 'NEW_ACCOUNT',
  SET_KEY: 'SET_KEY',
  FUNDING: 'FUNDING',
  UPDATE: 'UPDATE',
  IMPORTEXPORT: 'IMPORTEXPORT',
  DONATE: 'DONATE',
}

export const router = new Router({
  linkActiveClass: 'active',
  routes: [
    {
      path: '/',
      name: routes.TREE,
      component: Tree,
    },
    {
      path: '/options/:accountId',
      name: routes.ACCOUNT_OPTIONS,
      component: Options,
    },
    {
      path: '/new',
      name: routes.NEW_ACCOUNT,
      component: NewAccount,
    },
    {
      path: '/update',
      name: routes.UPDATE,
      component: Update,
    },
    {
      path: '/importexport',
      name: routes.IMPORTEXPORT,
      component: ImportExport,
    },
    {
      path: '/donate',
      name: routes.DONATE,
      component: Donate,
    },
  ],
})
