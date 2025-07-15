import express from 'express';
import {
  getAllAccessoriesItems,
 
  updateAccessoriesTracking
} from '../controllers/AccessoryController.js';

const router = express.Router();

router.route('/')
  .get(getAllAccessoriesItems)
  .patch(updateAccessoriesTracking)


export default router;