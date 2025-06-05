import express from 'express';
import {
  getAllCaps,

  createCap,
  updateCap,
  deleteCap
} from '../controllers/capDataController.js';

const router = express.Router();

router.route('/')
  .get(getAllCaps)
  .post(createCap);

router.route('/:id')

  .put(updateCap)
  .delete(deleteCap);

export default router;
