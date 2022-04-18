import Vue from 'vue'
import Router from 'vue-router'
import Tree from './views/native/Tree'
import Home from './views/native/Home'
import NewAccount from './views/NewAccount'
import AddBookmarkIntent from './views/native/AddBookmarkIntent'
import ImportExport from './views/native/ImportExport'
import About from './views/native/About'

Vue.use(Router)

export const routes = {
  HOME: 'HOME',
  TREE: 'TREE',
  ACCOUNT_OPTIONS: 'ACCOUNT_OPTIONS',
  NEW_ACCOUNT: 'NEW_ACCOUNT',
  ADD_BOOKMARK: 'ADD_BOOKMARK',
  FUNDING: 'FUNDING',
  UPDATE: 'UPDATE',
  IMPORTEXPORT: 'IMPORTEXPORT',
  DONATE: 'DONATE',
  ABOUT: 'ABOUT'

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
      component: () => import(/* webpackPrefetch: true */ './views/native/Options'),
    },
    {
      path: '/new',
      name: routes.NEW_ACCOUNT,
      component: NewAccount,
    },
    {
      path: '/update',
      name: routes.UPDATE,
      component: () => import(/* webpackPrefetch: true */ './views/Update'),
    },
    {
      path: '/newBookmark/:accountId/:url/:text?',
      name: routes.ADD_BOOKMARK,
      component: AddBookmarkIntent,
    },
    {
      path: '/importexport',
      name: routes.IMPORTEXPORT,
      component: ImportExport,
    },
    {
      path: '/about',
      name: routes.ABOUT,
      component: About,
    },
  ],
})
