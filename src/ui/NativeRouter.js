import Vue from 'vue'
import Router from 'vue-router'
import Tree from './views/native/Tree'
import Options from './views/native/Options'
import Home from './views/native/Home'

Vue.use(Router)

export const routes = {
  HOME: 'HOME',
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
      name: routes.HOME,
      component: Home,
    },
    {
      path: '/tree/:accountId',
      name: routes.TREE,
      component: Tree,
    },
    {
      path: '/options/:accountId',
      name: routes.ACCOUNT_OPTIONS,
      component: Options,
    },
  ],
})
