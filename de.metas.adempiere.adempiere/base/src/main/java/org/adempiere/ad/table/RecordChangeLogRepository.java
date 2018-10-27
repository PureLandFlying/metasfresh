package org.adempiere.ad.table;

import org.adempiere.model.InterfaceWrapperHelper;
import org.adempiere.util.lang.impl.TableRecordReference;
import org.springframework.stereotype.Repository;

import lombok.NonNull;

/*
 * #%L
 * de.metas.adempiere.adempiere.base
 * %%
 * Copyright (C) 2018 metas GmbH
 * %%
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as
 * published by the Free Software Foundation, either version 2 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public
 * License along with this program. If not, see
 * <http://www.gnu.org/licenses/gpl-2.0.html>.
 * #L%
 */

@Repository
public class RecordChangeLogRepository
{
	public RecordChangeLog getByRecord(final int adTableId, final ComposedRecordId recordId)
	{
		return RecordChangeLogLoader
				.ofAdTableId(adTableId)
				.getByRecordId(recordId);
	}

	public RecordChangeLog getSummaryByRecord(@NonNull final TableRecordReference recordRef)
	{
		final int adTableId = recordRef.getAD_Table_ID();
		final int recordId = recordRef.getRecord_ID();

		final String tableName = recordRef.getTableName();
		final String singleKeyColumnName = InterfaceWrapperHelper.getKeyColumnName(tableName);

		return RecordChangeLogLoader.ofAdTableId(adTableId)
				.getSummaryByRecordId(ComposedRecordId.singleKey(singleKeyColumnName, recordId));
	}

}
